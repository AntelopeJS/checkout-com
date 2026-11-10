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

Each journey says where it runs; [README](README.md) explains the two targets.

- `pay-approved` (sandbox, then stand-in): a token becomes a payment that reads `pending` until Checkout.com has captured it, then `succeeded`; the provider holds it captured for 2500 EUR under the reference, as a `Regular` payment. On the stand-in the request also carries the amount in minor units, currency, reference, processing channel, token source and the caller's idempotency key, which the sandbox does not show.
- `pay-declined` (sandbox, then stand-in): a declined card is a `failed` payment carrying the insufficient-funds code and Checkout.com's response code 20051, also on a later `GetPayment`; an unknown or malformed id is `PaymentNotFoundError`. On the stand-in, the malformed id sends no request.
- `pay-idempotent` (sandbox, then stand-in): the same key returns the first payment and a new key a new one; two concurrent calls under one key create one payment, each returning it or a retryable `PaymentError` (`duplicate_request`, which the sandbox sometimes answers), and a retry returns it. On the stand-in its log also shows the second request answered from the idempotency cache, and one payment created for the concurrent key.
- `pay-3ds` (stand-in only): a challenged payment is `requires_action` with the redirect and the return URL as success and failure URL, still reads `requires_action` with the same redirect while the payer is away, and ends `succeeded` or `failed` by the payer's outcome. The sandbox's challenge needs a password typed in an iframe, which no journey can drive, so the payer's outcome is the stand-in's lever.

## How to get to it (user POV)

- A module that imports `@antelopejs/interface-payment` and calls `CreatePayment(request, idempotencyKey, provider?)` with a Frames token.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" payments
```

## Gotchas

- Live, a payment that does not save a card asks for no 3-D Secure, so the sandbox authorizes it at once and captures it seconds later; `settled` reads the sandbox every second, for up to 45 s, until it shows `Captured`.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
