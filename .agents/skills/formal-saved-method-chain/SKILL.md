---
name: formal-saved-method-chain
description: Checks the saved-method chain of @antelopejs/checkout-com (RecordSavedMethod, RememberSave, FindSavedMethod, prunedMetadata, oneAtATime, and their callers LoadPayment, CreatePayment, ListPaymentMethods and DetachPaymentMethod) with a fast-check model of Checkout.com, under the request interleavings a fast-check scheduler picks. Use when a change touches a file in the coverage record or this folder, or when a change to saved cards needs proof that records survive concurrent saves, detaches and charges.
---

# Check the saved-method chain

Checkout.com stores a saved card with no link to the payment that saved it. The module keeps that link in the customer's metadata, one pair per card: `antelope_method_<src_…>` maps to `<pay_…> <saved at>`. An off-session charge reads it to send `previous_payment_id`, and `ListPaymentMethods` reads it for `createdAt`. These records share the customer's 20-pair limit with the caller's metadata and the `antelope_idempotency` key. Checkout.com has no conditional write, so concurrent writes can lose a record or leave one behind.

The check runs the module's real `CreateCustomer`, `CreatePayment`, `GetPayment`, `ListPaymentMethods` and `DetachPaymentMethod` against an in-memory Checkout.com. It stubs `globalThis.fetch` for each run and restores it afterwards. Every request, every operation start and every 3DS step of the payer is a task of a `fc.scheduler()`, so fast-check picks the order. Each rule runs as its own property under each PATCH semantics, so each broken rule shrinks to its own counterexample.

## Run the check

From the repository root, with Node 24 and `pnpm install` done:

```sh
node .agents/skills/formal-saved-method-chain/check.mts
```

No build is needed. `check.mts` registers a module hook that transpiles each file under `src/` with the repository's `tsconfig.json` as it is imported. The verify tool runs the check in a base worktree that has no `dist/`, and the check still tests that worktree's own code. A run takes about 4 seconds.

The check uses fast-check 4.10.2 from the exact devDependency. Seed `20261110`, 1000 runs per rule and semantics. The seed, the run count, the generators and the fast-check version fix every counterexample, so keep all four unchanged when you compare a result with this record.

It prints, in order:

- One `coverage <semantics>:` line per semantics. Each line counts what the 1000 runs reached.
- One `holds` line that names every rule that held and is not a recorded finding.
- One line per rule that differs from holding. `finding <Rule> (<N> states)` names a recorded finding that still breaks at its recorded length. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose counterexample length changed. `HOLDS` names a finding that no longer breaks. A broken rule's line is followed by its seed, its shrink path, the shrunk scenario and the numbered trace.

Exit 0 means the result matches the record in `check.mts`. Exit 1 means a rule changed. Exit 2 means the check could not run. That covers a wrong argument, a source that fails to load, and a request or body the model does not answer, which is reported as `ModelGap`. A rule name carries its semantics, as in `MetadataLimit_merge`.

`N states` counts as TLC counts a trace: the initial state, then one state per request the model answered or 3DS step the payer took, up to the step that breaks the rule. A rule checked at quiescence counts every step of the run.

## The model

`provider.mts` holds one customer and answers `POST /customers`, `GET` and `PATCH /customers/{id}`, `PATCH` and `DELETE /instruments/{id}`, `POST /payments` and `GET /payments/{id}`. It follows what the sandbox showed on 2026-11-10:

- `PATCH /customers/{id}` with `metadata` replaces the whole map. Without `metadata` it keeps the map. There is no ETag, and `If-Match` is ignored.
- `GET /customers/{id}` always lists `instruments` and reflects a deleted instrument at once.
- A saving payment links its instrument to the customer as soon as Checkout.com takes it, before 3DS.
- A saving payment that needs 3DS answers `202` with a redirect and no `source`. Reads of it show `source: {"type": "card"}` with no id until the payer passes 3DS.

The `merge` semantics is not observed. It models a provider that merges a PATCH into the stored map. The model never refuses a write over 20 pairs, so `MetadataLimit` reports what the module would make Checkout.com hold.

`scenario.mts` generates one run. It creates the customer with caller metadata, then starts every operation at once. A card operation starts only after its saving payment reached Checkout.com, because the app learns the card from that answer. The drive loop waits a full event-loop turn before it releases each task, so the loop never stops while a woken operation is about to send a request. A run with no task left and an operation still open is a deadlock.

| Operation | What it calls |
| --- | --- |
| `save cardN` (frictionless or 3DS) | `CreatePayment` with a token, the customer and `savePaymentMethod` |
| `return cardN` | The payer passes 3DS, then the app calls `GetPayment`, which runs `LoadPayment` |
| `read cardN` | `GetPayment` on the saving payment, possibly before 3DS |
| `charge cardN` | `CreatePayment` off-session with the saved card and the customer |
| `detach cardN` | `DetachPaymentMethod` |
| `list` | `ListPaymentMethods` |

## The rules

| Rule | Plain sentence | Checked | Replace | Merge |
| --- | --- | --- | --- | --- |
| `MetadataLimit` | No customer holds more than 20 pairs, and the module sends no customer write over 20. | every step | holds | finding (9) |
| `CallerKeysKept` | Every caller key given to `CreateCustomer` keeps its value. | every step | holds | holds |
| `ChainMatchesRecord` | An off-session charge sends `previous_payment_id` exactly when the customer read it made held a record for the card, and then sends the recorded payment. | each charge | holds | holds |
| `RecordKept` | Once a card's record is stored, it names the same payment for as long as the customer has the card. | every step | holds | holds |
| `ListMatchesRecord` | `ListPaymentMethods` answers the cards its read saw, each with the record's save time or 0. | each list | holds | holds |
| `NoRecordOutlivesInstrument` | No record names a card the customer no longer has. | quiescence | finding (6) | finding (6) |
| `Settles` | Every operation settles once no request is left to answer. | quiescence | holds | holds |

`RecordKept` is the only rule that sees the lost update `oneAtATime` prevents. `ListMatchesRecord` is the only rule over `ListPaymentMethods`. `Settles` turns a wedged write queue into a finding instead of a hung check.

## Judge the result

1. Read the trace. Each numbered line is one step. It shows the operation, the request, the answer, and the customer's pair count, records and cards after the step. A line with `·` is an operation start or what the module wrote to stderr. A line with `!` is a rule breaking.
2. A `ModelGap` (exit 2) means the module sent a request the model does not answer. Extend the model from a sandbox observation before you trust any result.
3. A `BROKEN` rule is a product failure until the trace shows the model at fault. Report the counterexample before you propose a fix, exclude inputs, or move the record.
4. When a fix lands, its PR moves the finding out of `FINDINGS` in `check.mts` and this file, so the rule prints in the `holds` line.

## Bounds and exclusions

Each run has one customer with 0 to 2 or 15 to 19 caller keys, weighted 1 to 3 toward the limit. It has 1 to 4 saving payments, each frictionless or 3DS, and up to 8 further operations. This is randomized testing of real code under generated interleavings, not an exhaustive proof.

Not modeled:

- Two processes. `oneAtATime` serializes record writes for one customer only within a process, and its TSDoc already names the cross-process loss.
- Webhooks, hosted checkout sessions and their `saveFor`, and a payer who fails 3DS.
- Transport errors, timeouts and 5xx answers.
- A refusal of a write over 20 pairs. The stand-in answers 422, but the sandbox's answer is unobserved.
- Caller keys that look like the module's own. PR #40 drops them, and this check generates plain keys only.

## Coverage record

Last code synchronization is the head of the pull request that adds this skill, on top of `fix/serialize-saved-method-records` at `be67bf6`.

| File | Covered functions and role |
| --- | --- |
| `src/implementations/payment/saved-methods.ts` | `RecordSavedMethod`, `RememberSave`, `FindSavedMethod`, `ReadSavedMethod`, `prunedMetadata`, `oneAtATime` |
| `src/implementations/payment/follow.ts` | `LoadPayment`, which records a card on the first read past 3DS |
| `src/implementations/payment/payments.ts` | `CreatePayment`, `initiation` and `initialPaymentOf` for `previous_payment_id`, `GetPayment` |
| `src/implementations/payment/customers.ts` | `CreateCustomer`, `ListPaymentMethods`, `DetachPaymentMethod` |

The `formal` entry in `verify.config.ts` covers these four files. `mapping.ts` (`ToPayment`, `WriteMetadata`), `http.ts` and `resources.ts` also shape what the chain does, but the gate does not see them. After a covered change, compare the model with these assumptions and rerun the check.

The coverage lines at the pinned seed are the same for both semantics, except the charge counts:

```text
coverage replace: 743 of 1000 runs interleave operations; 1075 records written, 165 after 3DS; 127 off-session charges chained, 607 not; 109 recorded cards detached; 730 lists; saved cards left without a record: 715 still in 3DS, 187 authorized
```

The 715 cards still in 3DS are saves with no `return` for that card. The 187 authorized cards without a record are cards the 20-pair limit refused, since `RecordKept` holds and a detached card is not counted. Most of them come from runs at 18 or 19 caller keys, where at most one record fits. That split is inferred from the weighting, not counted.

## Findings

Recorded in `FINDINGS` in `check.mts`, at seed `20261110`.

### NoRecordOutlivesInstrument, under both semantics (6 states)

Shrink path `6:0:1:0:2:2:2`. Scenario `{"callerKeys":15,"saves":["frictionless"],"ops":[{"kind":"detach","card":0}]}`.

```text
  1 #0 create: POST /customers -> 201 [16 pairs; records none; cards none]
  2 #1 save card1: POST /payments -> 201 [16 pairs; records none; cards card1]
  3 #1 save card1: GET /customers/cus -> 200 [16 pairs; records none; cards card1]
  4 #2 detach card1: DELETE /instruments/card1 -> 204 [16 pairs; records none; cards none]
  5 #1 save card1: PATCH /customers/cus -> 204 [17 pairs; records card1=save1; cards none]
  ! at quiescence the record for card1 names a card the customer no longer has
```

`DetachPaymentMethod` deletes the instrument and leaves its record. The record stays until a later save prunes it, and under merge no save prunes it. In this trace the detach lands between the save's read and its write, so the save writes a record for a card that is already gone. A fix that prunes only inside `DetachPaymentMethod` would still lose this interleaving unless the detach waits for the record writes too. That last point is inferred from the trace.

### MetadataLimit, under merge (9 states)

Shrink path `46:10:8:12:12:2:2`. Scenario `{"callerKeys":18,"saves":["frictionless","frictionless"],"ops":[{"kind":"detach","card":2}]}`.

```text
  1 #0 create: POST /customers -> 201 [19 pairs; records none; cards none]
  2 #1 save card1: POST /payments -> 201 [19 pairs; records none; cards card1]
  3 #1 save card1: GET /customers/cus -> 200 [19 pairs; records none; cards card1]
  4 #3 detach card1: DELETE /instruments/card1 -> 204 [19 pairs; records none; cards none]
  5 #1 save card1: PATCH /customers/cus -> 204 [20 pairs; records card1=save1; cards none]
  6 #2 save card2: POST /payments -> 201 [20 pairs; records card1=save1; cards card2]
  7 #2 save card2: GET /customers/cus -> 200 [20 pairs; records card1=save1; cards card2]
  8 #2 save card2: PATCH /customers/cus -> 204 [21 pairs; records card1=save1 card2=save2; cards card2]
  ! the customer holds 21 pairs
```

The module prunes card1's stale record from the map it sends and counts 20 pairs. A merging provider keeps the pruned key, so the customer ends at 21. Under replace, the same write leaves 20 pairs. The module never sends more than 20 under either semantics.

## Mutation evidence

Each scratch change below was applied to `src/`, run through the check, and reverted. The check then reported the record above again.

| Scratch change | Result |
| --- | --- |
| `RememberSave` calls `RecordSavedMethod` directly, without `oneAtATime` | `BROKEN RecordKept_replace (9 states)`: two saves read the same metadata, and the second PATCH drops card2's record |
| Remove the 20-pair guard in `RecordSavedMethod` | `BROKEN MetadataLimit_replace (8 states)`: the module sent PATCH /customers with 21 pairs |
| `prunedMetadata` keeps only `antelope_method_` keys | `BROKEN CallerKeysKept_replace (5 states)`: caller key caller_00 reads nothing |
| `initiation` never sets `previous_payment_id` | `BROKEN ChainMatchesRecord` under both semantics (7 states) |
| `ListPaymentMethods` always answers `createdAt` 0 | `BROKEN ListMatchesRecord` under both semantics (7 states) |

A mutation can also move `MetadataLimit_merge` off its recorded 9 states, because a changed module shrinks to a different interleaving. `Settles` has no mutation: no plausible edit of `oneAtATime` leaves a write that never settles.
