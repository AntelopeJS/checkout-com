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

- `refund-flow`: a partial refund is accepted as `pending` with an id made of the payment id and the action id, reaches Checkout.com under the caller's key, settles to `succeeded`, shows in the payment's refunded amount and leaves Checkout.com holding it as partially refunded; a refund above what is left is `InvalidPaymentStateError` and an unknown action `PaymentNotFoundError`.
- `refund-declined`: an issuer refusing the refund (the stand-in refuses the next refund on request; the sandbox has no trigger for it) is a `PaymentError` carrying `refund_authorization_declined`, and nothing is refunded.

## How to get to it (user POV)

- A module that calls `RefundPayment({ payment, amount?, reason? }, idempotencyKey)`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" refunds
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
