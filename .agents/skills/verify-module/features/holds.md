---
covers:
  - src/implementations/payment/payments.ts
  - src/implementations/payment/follow.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/guards.ts
  - src/implementations/payment/http.ts
  - src/implementations/payment/ids.ts
  - src/implementations/payment/json.ts
  - src/implementations/payment/lookup.ts
  - src/implementations/payment/mapping.ts
  - src/implementations/payment/resources.ts
  - src/implementations/payment/saved-methods.ts
  - src/index.ts
  - src/config.ts
  - src/implementations/payment/index.ts
docs:
  - README.md
  - docs/2.payments.md
journeys:
  - hold-capture
  - hold-cancel
  - hold-settle-budget
---

# Holds

An application module authorizes first and settles later: `CapturePayment` or `CancelPayment` on a payment created with `authorizeOnly`.

## Sub-features

Each journey says where it runs; [README](README.md) explains the two targets.

- `hold-capture` (sandbox, then stand-in): an `authorizeOnly` payment reads `authorized` with nothing captured; a partial capture returns with 1000 applied and leaves the provider holding 1000 of the 2500 captured, which also shows it was not captured by itself; the payment ends `succeeded` with that amount; capturing a payment Checkout.com captures by itself is `InvalidPaymentStateError`. On the stand-in the log also shows `capture: false`, the capture of 1000 under the caller's key, and no capture request for the automatic payment.
- `hold-cancel` (sandbox, then stand-in): cancelling a hold reads `canceled` and the provider holds it voided for the whole amount; cancelling a payment still waiting for 3-D Secure is `InvalidPaymentStateError`, and the sandbox still holds it `Pending`. On the stand-in the log shows one void for the hold, and the void of the waiting payment asked and refused with 422 `no_balance_available_to_void`, the sandbox's answer.
- `hold-settle-budget` (sandbox, then stand-in): on an account with `settleTimeoutMs: 0`, `CapturePayment` of a hold returns the payment as Checkout.com last reported it (still `authorized`, nothing captured) instead of waiting; once the provider shows the capture applied for the whole amount, `GetPayment` reads `succeeded`. `hold-capture`, on the default budget, is the contrast: its capture call already returns the applied amount.

## How to get to it (user POV)

- A module that calls `CapturePayment(id, idempotencyKey, amount?)` or `CancelPayment(id, idempotencyKey)` once the order is confirmed or abandoned.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" holds
```

## Gotchas

- The sandbox refuses the void of a payment waiting for 3-D Secure with `422 no_balance_available_to_void` (observed 2026-11-10), where the stand-in answers 403: only the sandbox pass of `hold-cancel` exercises the code Checkout.com sends.
- `hold-settle-budget` relies on the sandbox taking longer than one read to apply a capture; it applies captures within seconds.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
