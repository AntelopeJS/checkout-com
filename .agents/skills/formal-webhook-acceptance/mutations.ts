import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves the check can fail: each mutant is a scratch copy of signature.ts
 * with one edit, run through check.ts by `WEBHOOK_SIGNATURE_SOURCE`. Prints
 * the mutants the check did not catch and exits 1 when there are any; with
 * `--table` it prints one line per mutant with the rules it broke. Exits 2
 * when an edit no longer applies to the source or the check cannot run.
 */

interface Mutant {
  name: string;
  from: string;
  to: string;
}

interface Result {
  name: string;
  caught: boolean;
  broken: string[];
  first: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../../src/implementations/payment/signature.ts");
const AUTHORIZATION_COMPARE = "!sameBytes(Buffer.from(received), Buffer.from(authorization))";

const MUTANTS: Mutant[] = [
  { name: "drop-trim", from: "?.trim()", to: "" },
  { name: "lower-case-hex-only", from: "/^[0-9a-f]{64}$/i", to: "/^[0-9a-f]{64}$/" },
  { name: "skip-authorization", from: "assertAuthorized(request, authorization);", to: "" },
  {
    name: "case-sensitive-header-names",
    from: "header.toLowerCase() === name",
    to: "header === name",
  },
  {
    name: "empty-key-allowed",
    from: "if (!signatureKey) {",
    to: "if (signatureKey === undefined) {",
  },
  {
    name: "compare-first-16-bytes",
    from: "timingSafeEqual(left, right)",
    to: "timingSafeEqual(left.subarray(0, 16), right.subarray(0, 16))",
  },
  {
    name: "body-through-utf8",
    from: ".update(request.body)",
    to: ".update(Buffer.from(request.body).toString())",
  },
  {
    name: "body-view-ignored",
    from: ".update(request.body)",
    to: ".update(Buffer.from(request.body.buffer))",
  },
  {
    name: "missing-signature-crashes",
    from: "readHeader(request.headers, SIGNATURE_HEADER)?.trim()",
    to: "readHeader(request.headers, SIGNATURE_HEADER)!.trim()",
  },
  { name: "authorization-by-prefix", from: AUTHORIZATION_COMPARE, to: "!received.startsWith(authorization)" },
  {
    name: "authorization-trimmed",
    from: 'readHeader(request.headers, AUTHORIZATION_HEADER) ?? ""',
    to: '(readHeader(request.headers, AUTHORIZATION_HEADER) ?? "").trim()',
  },
  {
    name: "authorization-case-insensitive",
    from: AUTHORIZATION_COMPARE,
    to: "received.toLowerCase() !== authorization.toLowerCase()",
  },
];

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function runMutant(mutant: Mutant, source: string, folder: string): Result {
  if (!source.includes(mutant.from)) {
    fail(`mutant ${mutant.name}: the text it edits is gone from signature.ts`);
  }
  const file = path.join(folder, "signature.ts");
  writeFileSync(file, source.replace(mutant.from, mutant.to));
  const run = spawnSync(process.execPath, [path.join(here, "check.ts")], {
    encoding: "utf8",
    env: { ...process.env, WEBHOOK_SIGNATURE_SOURCE: file },
  });
  if (run.status === 2) {
    fail(`mutant ${mutant.name}: the check could not run\n${run.stderr}`);
  }
  const lines = run.stdout.split("\n");
  const broken = lines.flatMap((line) => /^(?:BROKEN|CHANGED) (\w+)/.exec(line)?.[1] ?? []);
  const at = lines.findIndex((line) => line.startsWith("BROKEN "));
  const first = at < 0 ? "" : lines.slice(at, at + 3).join("\n");
  return { name: mutant.name, caught: run.status === 1, broken, first };
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--table")) {
  fail("usage: node mutations.ts [--table]");
}
const source = readFileSync(SOURCE, "utf8");
const folder = mkdtempSync(path.join(tmpdir(), "webhook-mutants-"));
const results = MUTANTS.map((mutant) => runMutant(mutant, source, folder));
rmSync(folder, { recursive: true, force: true });
for (const result of results) {
  if (args.includes("--table")) {
    console.log(`${result.caught ? "caught" : "MISSED"} ${result.name}: ${result.broken.join(", ")}`);
    console.log(result.first);
  } else if (!result.caught) {
    console.log(`MISSED ${result.name}`);
  }
}
process.exit(results.every((result) => result.caught) ? 0 : 1);
