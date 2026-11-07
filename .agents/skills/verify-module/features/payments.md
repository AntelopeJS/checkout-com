---
covers:
  - src/implementations/payment/payments.ts
  - src/implementations/payment/mapping.ts
  - src/implementations/payment/follow.ts
  - src/implementations/payment/resources.ts
  - src/implementations/payment/cko-types.ts
  - src/implementations/payment/guards.ts
  - src/implementations/payment/json.ts
  - src/implementations/payment/lookup.ts
  - src/implementations/payment/ids.ts
  - src/implementations/payment/index.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/http.ts
  - src/implementations/payment/saved-methods.ts
  - src/index.ts
  - src/config.ts
docs:
  - README.md
  - docs/2.payments.md
journeys:
  - pay-approved
  - pay-declined
  - pay-idempotent
  - pay-3ds
---

# Payments

An application module charges a card token with `CreatePayment` and reads the payment back with `GetPayment`.

## Sub-features

- `pay-approved`: a token becomes one payment request with the amount in minor units, currency, reference, processing channel, token source and the caller's idempotency key; it reads `pending` until Checkout.com has captured it, then `succeeded`, and Checkout.com itself holds it as captured.
- `pay-declined`: a declined card is a `failed` payment carrying the insufficient-funds code and Checkout.com's response code, also on a later `GetPayment`; an unknown or malformed id is `PaymentNotFoundError`, the malformed one without a call.
- `pay-idempotent`: the same key returns the first payment and Checkout.com answers the second request from its cache; a new key is a new payment.
- `pay-3ds`: a challenged payment is `requires_action` with the redirect and the return URL as success and failure URL, reads `pending` while the payer is away, and ends `succeeded` or `failed` by the payer's outcome.

## How to get to it (user POV)

- A module that imports `@antelopejs/interface-payment` and calls `CreatePayment(request, idempotencyKey, provider?)` with a Frames token.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" payments
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
