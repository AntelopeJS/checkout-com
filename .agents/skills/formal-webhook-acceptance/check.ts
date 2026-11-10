import fc from "fast-check";

import { deliveries } from "./deliveries.ts";
import { observations } from "./observations.ts";
import { expectation, type Facts, hmacSha256Hex } from "./oracle.ts";
import { outcomeOf, RULES, type Rule, type RuleName } from "./rules.ts";

/**
 * Checks the webhook acceptance predicate `AssertGenuine` against an oracle
 * written from the contract in docs/4.webhooks.md, over generated deliveries.
 * Prints one `holds` line for the rules that hold and one `finding`, `BROKEN`,
 * `CHANGED` or `HOLDS` line for each rule that does not match the record
 * below. Exits 0 when every rule matches the record, 1 when a rule changed and
 * 2 when the check could not run. `--report` also prints the generated
 * coverage and the module's behaviour where the contract names no answer.
 */

const SEED = Number(process.env.FC_SEED ?? 20261110);
const RUNS = 4000;
const MIN_DOMAIN = 150;
const RFC_4231_CASE_2 = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

/** Rules main breaks, each with the shrink steps to its counterexample. Every other rule holds. */
const FINDINGS: Partial<Record<RuleName, number>> = {};

interface Judgement {
  rule: RuleName;
  matches: boolean;
  line?: string;
  detail?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function judge(rule: Rule): Judgement {
  const property = fc.property(deliveries, (delivery) => {
    if (rule.applies(expectation(delivery))) {
      rule.holds(outcomeOf(delivery));
    }
  });
  const result = fc.check(property, { seed: SEED, numRuns: RUNS });
  const recorded = FINDINGS[rule.name];
  if (!result.failed) {
    return recorded === undefined
      ? { rule: rule.name, matches: true }
      : { rule: rule.name, matches: false, line: `HOLDS ${rule.name}` };
  }
  const states = result.numShrinks;
  const reason = result.errorInstance instanceof Error ? result.errorInstance.message : "";
  const detail = `  ${reason}\n  counterexample: ${fc.stringify(result.counterexample?.[0])}`;
  if (recorded === states) {
    return { rule: rule.name, matches: true, line: `finding ${rule.name} (${states} states)`, detail };
  }
  const label = recorded === undefined ? "BROKEN" : "CHANGED";
  return { rule: rule.name, matches: false, line: `${label} ${rule.name} (${states} states)`, detail };
}

function tally(facetsOf: (facts: Facts) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const delivery of fc.sample(deliveries, { seed: SEED, numRuns: RUNS })) {
    for (const facet of facetsOf(expectation(delivery))) {
      counts.set(facet, (counts.get(facet) ?? 0) + 1);
    }
  }
  return counts;
}

const domainsOf = (facts: Facts): string[] =>
  RULES.filter((rule) => rule.applies(facts)).map((rule) => rule.name);

const factsOf = (facts: Facts): string[] => [
  `key ${facts.key}`,
  `signature ${facts.signature}`,
  `authorization ${facts.authorization}`,
  `verdict ${facts.verdict}`,
];

function selfTest(): void {
  const vector = hmacSha256Hex("Jefe", Buffer.from("what do ya want for nothing?"));
  if (vector !== RFC_4231_CASE_2) {
    fail(`the oracle's HMAC-SHA256 misses RFC 4231 test case 2: ${vector}`);
  }
  const domains = tally(domainsOf);
  for (const rule of RULES) {
    if ((domains.get(rule.name) ?? 0) < MIN_DOMAIN) {
      fail(`generator drift: fewer than ${MIN_DOMAIN} of ${RUNS} deliveries reach ${rule.name}`);
    }
  }
}

function report(): void {
  for (const counts of [tally(factsOf), tally(domainsOf)]) {
    for (const [facet, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
      console.log(`coverage ${facet}: ${count} of ${RUNS}`);
    }
  }
  for (const line of observations()) {
    console.log(line);
  }
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--report")) {
  fail("usage: node check.ts [--report]");
}
selfTest();
const judged = RULES.map(judge);
const holding = judged.filter((entry) => entry.matches && entry.line === undefined);
if (holding.length > 0) {
  console.log(
    `holds ${holding.map((entry) => entry.rule).join(", ")} (${RUNS} runs each, seed ${SEED})`,
  );
}
for (const entry of judged) {
  if (entry.line !== undefined) {
    console.log(entry.line);
  }
  if (entry.detail !== undefined) {
    console.log(entry.detail);
  }
}
if (args.includes("--report")) {
  report();
}
process.exit(judged.every((entry) => entry.matches) ? 0 : 1);
