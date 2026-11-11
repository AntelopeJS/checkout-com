---
covers:
  - src/implementations/payment/refunds.ts
  - src/implementations/payment/ids.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/follow.ts
  - src/implementations/payment/guards.ts
  - src/implementations/payment/http.ts
  - src/implementations/payment/json.ts
  - src/implementations/payment/lookup.ts
  - src/implementations/payment/mapping.ts
  - src/implementations/payment/resources.ts
  - src/index.ts
  - src/config.ts
  - src/implementations/payment/index.ts
docs:
  - README.md
  - docs/2.payments.md
journeys:
  - refund-flow
  - refund-declined
---

# Refunds

An application module refunds all or part of a captured payment with `RefundPayment` and follows it with `GetRefund`.

## Sub-features

Each journey says where it runs; [README](README.md) explains the two targets.

- `refund-flow` (sandbox, then stand-in): a partial refund is accepted as `pending` with an id made of the payment id and the action id, settles to `succeeded`, shows in the payment's refunded amount and leaves the provider holding the payment partially refunded, 1000 of it; a refund above what is left is `InvalidPaymentStateError` and an unknown action `PaymentNotFoundError`. On the stand-in the log also shows the refund of 1000 under the caller's key. When the sandbox account lacks the balance, the refund fails later with response code 50003 and the journey ends NOT VERIFIED (`not verified live: sandbox balance (50003)`) before judging what depends on it.
- `refund-declined` (stand-in only): an issuer refusing the refund is a `PaymentError` carrying `refund_authorization_declined`, and nothing is refunded. The sandbox has no trigger for an issuer's refusal (it approved a refund of 3738), so the stand-in refuses the next refund on request.

## How to get to it (user POV)

- A module that calls `RefundPayment({ payment, amount?, reason? }, idempotencyKey)`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" refunds
```

## Gotchas

- The sandbox refuses an over-refund with `422 refund_amount_exceeds_balance` (observed 2026-11-10): only the sandbox pass of `refund-flow` exercises the code Checkout.com sends.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
