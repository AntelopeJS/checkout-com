/**
 * Checks the saved-method chain of @antelopejs/checkout-com with fast-check:
 * the module's own CreateCustomer, CreatePayment, GetPayment,
 * ListPaymentMethods and DetachPaymentMethod run against the in-memory
 * Checkout.com of provider.mts, every request delivered through a fast-check
 * scheduler, once with PATCH replacing the customer's metadata and once with
 * it merging. Each rule of each semantics is its own property, so each broken
 * rule shrinks to its own counterexample.
 *
 * It loads `src/` of the checkout it runs from, transpiled as it is imported,
 * so a base worktree with no build checks its own code. Prints one `holds`
 * line, then one line per broken rule. Exits 0 when every rule matches the
 * record below, 1 when a rule changed, and 2 when the check itself could not
 * run.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fc, { type Parameters as Settings, type Scheduler } from "fast-check";
import ts from "typescript";

import { type Coverage, type Rule, type Semantics, RULES } from "./domain.mts";
import {
  type Chain,
  type Scenario,
  RunScenario,
  Scenarios,
} from "./scenario.mts";
import { IsError, ModelGap } from "./wire.mts";

const EXIT = { ok: 0, changed: 1, tool: 2 };
const SEED = 20261110;
const RUNS = 1000;
/** The semantics the sandbox showed (PATCH replaces the map), which decides the exit code. */
const GATED: Semantics = "replace";
/** A provider that merges a PATCH: reported for reference, never gating. */
const OBSERVED: Semantics = "merge";

/** The rules the module breaks today, with the states of each shrunk counterexample at the pinned seed. */
const FINDINGS = new Map<string, number>();

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

interface Failure {
  states: number;
  detail: string;
  scenario: Scenario;
  trace: string[];
  path: string | null;
  shrinks: number;
}

interface Result {
  name: string;
  failure: Failure | undefined;
}

/**
 * Transpiles each file under `src/` as it is loaded, with the repository's
 * compiler options, and resolves its extensionless relative imports to `.ts`.
 */
function transpileSources(): void {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(root, "tsconfig.json"),
    undefined,
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new ModelGap(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  );
  const options = {
    ...parsed?.options,
    sourceMap: false,
    declaration: false,
    noEmit: false,
  };
  const src = pathToFileURL(path.join(root, "src") + path.sep).href;
  registerHooks({
    resolve(specifier, context, next) {
      const isSourceImport =
        context.parentURL?.startsWith(src) === true &&
        specifier.startsWith(".");
      return next(
        isSourceImport && !path.extname(specifier)
          ? `${specifier}.ts`
          : specifier,
        context,
      );
    },
    load(url, context, next) {
      if (!url.startsWith(src) || !url.endsWith(".ts"))
        return next(url, context);
      const file = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: options,
        fileName: file,
      });
      return { format: "commonjs", source: outputText, shortCircuit: true };
    },
  });
}

async function loadChain(): Promise<Chain> {
  transpileSources();
  const payment = await import("../../../src/implementations/payment/index.ts");
  const { RegisterAccount } =
    await import("../../../src/implementations/payment/accounts.ts");
  const { ToAccount } = await import("../../../src/config.ts");
  const config = {
    secretKey: "sk_sbox_formal",
    processingChannelId: "pc_formal",
    baseUrl: "https://checkout.invalid",
  };
  RegisterAccount(undefined, ToAccount(config, config));
  return payment;
}

/** Checks one rule under one semantics; resolves to its shrunk counterexample, or undefined when it holds. */
async function checkRule(
  chain: Chain,
  rule: Rule,
  semantics: Semantics,
): Promise<Failure | undefined> {
  let last: Omit<Failure, "path" | "shrinks"> | undefined;
  let error: unknown;
  const property = fc.asyncProperty(
    Scenarios,
    fc.scheduler(),
    async (scenario, scheduler) => {
      try {
        const provider = await RunScenario(
          chain,
          scenario,
          scheduler,
          semantics,
        );
        const broken = provider.broken.get(rule);
        if (!broken) return true;
        last = { ...broken, scenario, trace: provider.trace };
        error = undefined;
        return false;
      } catch (cause) {
        last = undefined;
        error = cause;
        throw cause;
      }
    },
  );
  const details = await fc.check(property, settings());
  if (!details.failed) return undefined;
  if (!last)
    throw (
      error ?? new ModelGap(`${rule}_${semantics} failed without breaking it`)
    );
  return {
    ...last,
    path: details.counterexamplePath,
    shrinks: details.numShrinks,
  };
}

function settings(): Settings<[Scenario, Scheduler]> {
  return { seed: SEED, numRuns: RUNS };
}

function added(total: Coverage, reached: Coverage): Coverage {
  return {
    interleaved: total.interleaved + reached.interleaved,
    records: total.records + reached.records,
    recordedAfter3ds: total.recordedAfter3ds + reached.recordedAfter3ds,
    chained: total.chained + reached.chained,
    unchained: total.unchained + reached.unchained,
    detachedRecorded: total.detachedRecorded + reached.detachedRecorded,
    lists: total.lists + reached.lists,
    unrecordedIn3ds: total.unrecordedIn3ds + reached.unrecordedIn3ds,
    unrecordedAuthorized:
      total.unrecordedAuthorized + reached.unrecordedAuthorized,
  };
}

/** Counts what the runs of one semantics reached, so a `holds` line says what it covered. */
async function coverage(chain: Chain, semantics: Semantics): Promise<string> {
  let total: Coverage = {
    interleaved: 0,
    records: 0,
    recordedAfter3ds: 0,
    chained: 0,
    unchained: 0,
    detachedRecorded: 0,
    lists: 0,
    unrecordedIn3ds: 0,
    unrecordedAuthorized: 0,
  };
  await fc.assert(
    fc.asyncProperty(Scenarios, fc.scheduler(), async (scenario, scheduler) => {
      total = added(
        total,
        (await RunScenario(chain, scenario, scheduler, semantics)).coverage(),
      );
    }),
    settings(),
  );
  return `coverage ${semantics}: ${total.interleaved} of ${RUNS} runs interleave operations; ${total.records} records written, ${total.recordedAfter3ds} after 3DS; ${total.chained} off-session charges chained, ${total.unchained} not; ${total.detachedRecorded} recorded cards detached; ${total.lists} lists; saved cards left without a record: ${total.unrecordedIn3ds} still in 3DS, ${total.unrecordedAuthorized} authorized`;
}

function describe(failure: Failure): string {
  return [
    failure.detail,
    `  seed ${SEED}, path ${failure.path ?? "none"}, ${failure.shrinks} shrinks`,
    `  scenario ${JSON.stringify(failure.scenario)}`,
    ...failure.trace.map((line) => `  ${line}`),
  ].join("\n");
}

function verdictLine(
  name: string,
  failure: Failure | undefined,
): string | undefined {
  const recorded = FINDINGS.get(name);
  if (!failure)
    return recorded === undefined
      ? undefined
      : `HOLDS ${name}: the finding is gone (${RUNS} runs)`;
  if (recorded === undefined)
    return `BROKEN ${name} (${failure.states} states): ${describe(failure)}`;
  if (recorded !== failure.states) {
    return `CHANGED ${name} (${failure.states} states, recorded ${recorded}): ${describe(failure)}`;
  }
  return `finding ${name} (${failure.states} states): ${describe(failure)}`;
}

function report(results: Result[]): number {
  const holding = results.filter(
    ({ name, failure }) => !failure && !FINDINGS.has(name),
  );
  console.log(
    `holds ${holding.map(({ name }) => name).join(", ")} (${RUNS} runs each, seed ${SEED})`,
  );
  let isChanged = false;
  for (const { name, failure } of results) {
    const line = verdictLine(name, failure);
    if (line === undefined) continue;
    console.log(line);
    if (!line.startsWith("finding ")) isChanged = true;
  }
  return isChanged ? EXIT.changed : EXIT.ok;
}

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error("usage: node check.mts");
    return EXIT.tool;
  }
  const chain = await loadChain();
  console.log(
    `fast-check ${fc.__version}, seed ${SEED}, ${RUNS} runs per rule and semantics`,
  );
  const results: Result[] = [];
  console.log(await coverage(chain, GATED));
  for (const rule of RULES) {
    results.push({
      name: `${rule}_${GATED}`,
      failure: await checkRule(chain, rule, GATED),
    });
  }
  const exit = report(results);
  console.log(await coverage(chain, OBSERVED));
  for (const rule of RULES) {
    const failure = await checkRule(chain, rule, OBSERVED);
    console.log(
      failure
        ? `under ${OBSERVED}, ${rule} breaks (${failure.states} states): ${describe(failure)}`
        : `under ${OBSERVED}, ${rule} holds`,
    );
  }
  return exit;
}

try {
  process.exitCode = await main();
} catch (error) {
  const cause = IsError(error) && IsError(error.cause) ? error.cause : error;
  console.error(
    `check: ${IsError(cause) ? (cause.stack ?? cause.message) : String(cause)}`,
  );
  process.exitCode = EXIT.tool;
}
