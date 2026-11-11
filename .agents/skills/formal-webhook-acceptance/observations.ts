import { type Delivery, hmacSha256Hex } from "./oracle.ts";
import { outcomeOf } from "./rules.ts";

const KEY = "observation-key";
const SECRET = "observation-authorization";
const BODY = Buffer.from('{"id":"evt_observation","type":"payment_captured"}');
const GOOD = hmacSha256Hex(KEY, BODY);
const BAD = "0".repeat(64);

function observe(
  name: string,
  headers: Delivery["headers"],
  authorization?: string,
): string {
  const outcome = outcomeOf({ body: BODY, headers, key: KEY, authorization });
  return `observation ${name}: ${outcome.kind === "accepted" ? "accepts" : outcome.kind}`;
}

const padded = (space: string): Delivery["headers"] => ({
  "cko-signature": `${space}${GOOD}${space}`,
});

/**
 * Deliveries the contract leaves open, run once against the module. They are
 * reported, never judged: each one carries at least one value that only the
 * signature key (or the configured Authorization) can produce, so what the
 * module does with it lets nothing forged in.
 */
export function observations(): string[] {
  return [
    observe("array-bad-then-good-signature", { "cko-signature": [BAD, GOOD] }),
    observe("array-good-then-bad-signature", { "cko-signature": [GOOD, BAD] }),
    observe("names-by-case-bad-then-good", { "Cko-Signature": BAD, "CKO-SIGNATURE": GOOD }),
    observe("names-by-case-good-then-bad", { "Cko-Signature": GOOD, "CKO-SIGNATURE": BAD }),
    observe(
      "array-wrong-then-right-authorization",
      { "cko-signature": GOOD, authorization: ["wrong", SECRET] },
      SECRET,
    ),
    observe(
      "array-right-then-wrong-authorization",
      { "cko-signature": GOOD, authorization: [SECRET, "wrong"] },
      SECRET,
    ),
    observe("no-break-space-around-signature", padded(" ")),
    observe("byte-order-mark-around-signature", padded("﻿")),
    observe("line-separator-around-signature", padded(" ")),
    observe("kelvin-sign-signature-name", { "cKo-Signature": GOOD }),
    observe("empty-string-authorization-configured", { "cko-signature": GOOD }, ""),
  ];
}
