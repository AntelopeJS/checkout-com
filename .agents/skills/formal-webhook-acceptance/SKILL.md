---
name: formal-webhook-acceptance
description: Checks the webhook acceptance predicate AssertGenuine of @antelopejs/checkout-com against an oracle written from the contract, over generated deliveries. Use when a change touches src/implementations/payment/signature.ts, how VerifyWebhook passes the signature key and the Authorization value to it, or the webhook contract in docs/4.webhooks.md.
---

# Check the webhook acceptance predicate

Run this check when a change touches the coverage record below.

`VerifyWebhook` trusts a delivery only after `AssertGenuine` accepts it. A consumer's route acts on the payment event that follows. If `AssertGenuine` accepts a delivery it should refuse, anyone who can reach the route can fake a payment event. If it refuses a genuine one, Checkout.com redelivers for 30 hours and the consumer sees nothing.

The check compares the real `AssertGenuine` with an oracle that reads the contract and shares no code with the module. The contract is `docs/4.webhooks.md` ("Verification") and the `VerifyWebhook` TSDoc of `@antelopejs/interface-payment`.

## Run the check

From the repository root, with Node 24 and `pnpm install` done:

```sh
node .agents/skills/formal-webhook-acceptance/check.ts            # the check
node .agents/skills/formal-webhook-acceptance/check.ts --report   # also the coverage and the observations
node .agents/skills/formal-webhook-acceptance/mutations.ts --table
```

The check takes about 2 seconds and needs no build: it compiles `src/implementations/payment/signature.ts` in memory. It uses fast-check 4.10.2 from the pinned devDependency and lockfile. Each rule runs 4000 generated deliveries. The default seed is `20261110`. Set `FC_SEED` to the integer a failure printed to replay another run. Keep the generators and the fast-check version unchanged when you replay a seed.

- Exit 0 means every rule matches the record, and the output is one line: `holds AcceptsGenuine, RefusesForged, RefusesWithoutKey, AuthorizationRequired, OnlyVerificationErrors (4000 runs each, seed 20261110)`.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks, `CHANGED` a finding whose counterexample changed length, `HOLDS` a finding that no longer breaks. A `finding` line is a break the record accepts. Each broken rule prints its reason and the shrunk counterexample under its line. The number in `(N states)` is the count of shrink steps fast-check took to reach that counterexample.
- Exit 2 means the check could not run: the oracle's HMAC missed RFC 4231 test case 2, a generator no longer reaches a rule (fewer than 150 of 4000 deliveries), the source no longer exports `AssertGenuine`, or the arguments were wrong.

## The rules

The oracle reads each delivery and reports three facets, then a verdict.

- Key: `unset` when the signature key is the empty string, else `set`.
- Signature: every `Cko-Signature` value, from every header whose name equals `cko-signature` once ASCII letters are lowercased, string or array entry, is tested apart. A value is valid when, after stripping spaces, tabs, CR and LF from both ends, it is exactly 64 hex digits in either case and equals the HMAC-SHA256 hex digest of the body bytes under the key. The facet is `valid` when every value is, `invalid` when none is (a missing header, an empty array and an undefined value included), else `mixed`.
- Authorization: `unset` when none is configured. Otherwise every `Authorization` value is compared byte for byte with the configured one, with `matching`, `mismatching` and `mixed` read like the signature facet.

The verdict is `refused` when the key is unset, the signature is `invalid` or the authorization is `mismatching`. It is `ambiguous` when none of those holds and a facet is `mixed`. It is `genuine` otherwise.

| Rule | Plain sentence | Deliveries it covers |
| --- | --- | --- |
| `AcceptsGenuine` | A delivery the oracle calls genuine is accepted. | Any header name case, string or one-entry array values, either hex case, surrounding whitespace, unset or matching Authorization. |
| `RefusesForged` | A delivery whose signature is invalid is refused, whatever else it carries. | Signatures under another key, over a mutated or re-encoded body, truncated, extended, doubled, odd length, non-hex, one wrong digit, prefixed, base64, inner whitespace, empty, blank, missing. |
| `RefusesWithoutKey` | With no signature key, every delivery is refused. | All deliveries with the empty key, including a correct HMAC under the empty key and a matching Authorization. |
| `AuthorizationRequired` | A valid signature with a configured Authorization that does not come back is refused. | Missing, undefined, empty, wrong, prefix, suffix, padded, case-swapped, scheme-prefixed. |
| `OnlyVerificationErrors` | Every delivery, ambiguous ones included, is accepted or refused with `WebhookVerificationError`, never another error. | All generated deliveries. |

All five hold on main. `OnlyVerificationErrors` also checks that `AssertGenuine` returns `undefined` when it accepts.

## Bounds and exclusions

A delivery has:

- A body of 0 to 48 bytes, the empty body, fixed non-UTF-8 bytes, or JSON text, as a `Uint8Array`, a `Buffer`, or a view into a larger buffer with other bytes on both sides.
- A key that is empty (weight 2 of 10), ASCII, Unicode, or 65 to 100 binary characters, which is longer than the 64-byte HMAC block.
- An Authorization that is unset (weight 3 of 7), random, or one of five fixed tokens, one with surrounding spaces and one with non-ASCII characters.
- 0, 1, or 2 to 3 signature values and as many Authorization values. A value list is carried as a string, a one-entry array, an array, or two entries whose names differ only in case, under a header name of random letter case. An empty list is carried as no header, an `undefined` value, or an empty array.
- Up to three unrelated headers, among them `x-cko-signature`, `cko-signature-extra`, `__proto__` and a name with a trailing space, and a header map that is sometimes a null-prototype object.

The oracle's HMAC is RFC 2104 over `createHash("sha256")`, so `createHmac` is used only by the module. The self-test checks it against RFC 4231 test case 2.

This is randomized testing of real TypeScript code, not an exhaustive proof. It does not cover bodies over 48 bytes, header names with non-ASCII characters (see the observations), the header map of any particular HTTP framework, timing of the comparison, `GetAccount`, or how `webhookSignatureKey` and `webhookAuthorization` reach `AssertGenuine`.

## Coverage record

Last code synchronization is `41520b3`, the head of main when this skill was added.

| File | Covered functions and role |
| --- | --- |
| `src/implementations/payment/signature.ts` | `AssertGenuine`, `assertSigned`, `assertAuthorized`, `readHeader` and `sameBytes`, compiled from source in memory by `real.ts`. |
| `src/implementations/payment/webhooks.ts` | `VerifyWebhook` calls `AssertGenuine(request, account.webhookSignatureKey, account.webhookAuthorization)`. The call is read, not run. |
| `src/config.ts` | Lines 75 and 76 turn a missing key into `""` and an empty Authorization into `undefined`. Read, not run. |
| `.agents/skills/formal-webhook-acceptance/` | The oracle (`oracle.ts`), the generators (`deliveries.ts`, `signatures.ts`), the rules (`rules.ts`), the runner (`check.ts`), the loader (`real.ts`), the observations and the mutation runner. |

`covers` in `verify.config.ts` lists `signature.ts` alone. After a change to the other rows, confirm the call and the two config lines still pass those arguments, then rerun the check.

Generated coverage at the default seed and bounds (`--report`, a sample of 4000 with the same seed):

| Facet | Deliveries |
| --- | --- |
| Key set, unset | 3184, 816 |
| Signature valid, invalid, mixed | 1143, 2464, 393 |
| Authorization unset, matching, mismatching, mixed | 1667, 370, 1801, 162 |
| Verdict genuine, refused, ambiguous | 465, 3325, 210 |
| In the domain of `AcceptsGenuine`, `RefusesForged`, `RefusesWithoutKey`, `AuthorizationRequired` | 465, 1943, 816, 422 |

## Findings

None. All five rules hold on main at `41520b3`. An ambiguous delivery always carries a value that only the key holder, or the holder of the Authorization value, can produce, so no result for it lets a forged delivery in.

## Observations

Where the contract names no answer, the check reports what the module does and judges nothing. `--report` prints each line.

| Delivery | Module |
| --- | --- |
| `Cko-Signature` array of a bad then a good signature | refuses |
| Array of a good then a bad signature | accepts |
| Two names that differ only in case, bad then good | refuses |
| Two names that differ only in case, good then bad | accepts |
| `Authorization` array of a wrong then the right value, Authorization configured | refuses |
| `Authorization` array of the right then a wrong value | accepts |
| Signature with a no-break space, byte order mark or line separator on each side | accepts |
| Header named `cKo-Signature` (Kelvin sign) carrying a valid signature | accepts |
| Configured Authorization `""` | accepts with no Authorization header |

The module reads the first value: `readHeader` takes the first header whose lowercased name matches, then the first array entry. The module trims every Unicode space, where the contract says whitespace. `toLowerCase` folds the Kelvin sign to `k`, so that name counts as `cko-signature`; HTTP header names are ASCII, so no request can carry it. An empty configured Authorization never reaches `AssertGenuine` from `VerifyWebhook`, because `src/config.ts` maps it to `undefined`. None of these accepts a delivery without a valid signature, so none is a finding.

## Judge a failure

1. Read the reason and the shrunk counterexample. `body` is the raw bytes, `headers` the map as the module receives it, `key` the signature key and `authorization` the configured value.
2. Confirm the oracle is right before blaming the module. The facets come from `oracle.ts`, which follows the rules above.
3. Replay it through `VerifyWebhook` in `src/test` or a verify journey with the same bytes and headers. A break that only the check shows is a modeling error until a replay reproduces it.
4. Keep a product failure as a finding in this file, with the counterexample, before you propose a fix. Never exclude the input, skip a rule or move a rule's domain to pass.

## Mutation evidence

Each scratch change below was applied to a copy of `signature.ts` by `mutations.ts`, caught, and discarded. The unmutated source reports `holds` for all five rules. The counterexamples are shortened.

| Scratch change | Rule broken | Shrunk counterexample |
| --- | --- | --- |
| Drop the `trim()` of the signature | `AcceptsGenuine` | empty body, signature `b613…c5ad ` with a trailing space |
| Accept lower-case hex only | `AcceptsGenuine` | empty body, the same digest in upper case |
| Skip `assertAuthorized` | `AuthorizationRequired` | valid signature, configured `"\u0000"`, header `"\u0000x"` |
| Compare header names case-sensitively | `AcceptsGenuine` | header name `cko-signatUre` |
| Treat an empty key as configured | `RefusesWithoutKey` | key `""`, HMAC under the empty key |
| Compare the first 16 bytes of the digest | `RefusesForged` | a signature that is right in its first 16 bytes only |
| Hash the body as UTF-8 text | `AcceptsGenuine`, `RefusesForged` | body `[255, 254, 253]` |
| Hash the whole underlying buffer of a view | `AcceptsGenuine` | body `{}` held in a larger buffer |
| Let a missing signature header throw `TypeError` | `RefusesForged`, `OnlyVerificationErrors` | no `Cko-Signature` header |
| Compare the Authorization by prefix | `AuthorizationRequired` | configured `"\u0000"`, header `"\u0000x"` |
| Trim the received Authorization | `AcceptsGenuine`, `AuthorizationRequired` | configured `"  spaced  "`, header `"  spaced  "` |
| Compare the Authorization case-insensitively | `AuthorizationRequired` | configured `Bearer abc123`, header `bEARER ABC123` |

`mutations.ts` exits 0 when it catches all twelve, prints `MISSED <name>` for each it does not and exits 1, and exits 2 when an edit no longer applies to `signature.ts`. Update its edits when `signature.ts` changes.
