import { type Delivery, type Facts } from "./oracle.ts";
import { AssertGenuine, WebhookVerificationError } from "./real.ts";

/** What the module did with a delivery: it returned, threw its verification error, or threw something else. */
export type Outcome =
  | { kind: "accepted" }
  | { kind: "returned"; returned: unknown }
  | { kind: "refused"; message: string }
  | { kind: "crashed"; error: unknown };

export const RULE_NAMES = [
  "AcceptsGenuine",
  "RefusesForged",
  "RefusesWithoutKey",
  "AuthorizationRequired",
  "OnlyVerificationErrors",
] as const;

export type RuleName = (typeof RULE_NAMES)[number];

/** A claim about the module over the deliveries the oracle puts in its domain: `holds` throws when the outcome breaks it. */
export interface Rule {
  name: RuleName;
  applies(facts: Facts): boolean;
  holds(outcome: Outcome): void;
}

export function outcomeOf(delivery: Delivery): Outcome {
  try {
    const returned: unknown = AssertGenuine(
      { body: delivery.body, headers: delivery.headers },
      delivery.key,
      delivery.authorization,
    );
    return returned === undefined ? { kind: "accepted" } : { kind: "returned", returned };
  } catch (error) {
    return error instanceof WebhookVerificationError
      ? { kind: "refused", message: error.message }
      : { kind: "crashed", error };
  }
}

function describe(outcome: Outcome): string {
  switch (outcome.kind) {
    case "crashed":
      return `threw ${String(outcome.error)}`;
    case "returned":
      return `returned ${String(outcome.returned)}`;
    default:
      return outcome.kind;
  }
}

function mustBe(outcome: Outcome, wanted: Outcome["kind"], why: string): void {
  if (outcome.kind !== wanted) {
    throw new Error(`${why}, and the module ${describe(outcome)}`);
  }
}

function onlyVerificationErrors(outcome: Outcome): void {
  if (outcome.kind === "crashed" || outcome.kind === "returned") {
    throw new Error(`the module ${describe(outcome)}`);
  }
}

export const RULES: Rule[] = [
  {
    name: "AcceptsGenuine",
    applies: (facts) => facts.verdict === "genuine",
    holds: (outcome) =>
      mustBe(
        outcome,
        "accepted",
        "the signature is valid and any configured Authorization came back",
      ),
  },
  {
    name: "RefusesForged",
    applies: (facts) => facts.key === "set" && facts.signature === "invalid",
    holds: (outcome) =>
      mustBe(outcome, "refused", "no Cko-Signature value is the HMAC of the body under the key"),
  },
  {
    name: "RefusesWithoutKey",
    applies: (facts) => facts.key === "unset",
    holds: (outcome) => mustBe(outcome, "refused", "no signature key is configured"),
  },
  {
    name: "AuthorizationRequired",
    applies: (facts) =>
      facts.key === "set" && facts.signature === "valid" && facts.authorization === "mismatching",
    holds: (outcome) =>
      mustBe(
        outcome,
        "refused",
        "the signature is valid but no Authorization value is the configured one",
      ),
  },
  {
    name: "OnlyVerificationErrors",
    applies: () => true,
    holds: onlyVerificationErrors,
  },
];
