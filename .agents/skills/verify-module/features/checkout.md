---
covers:
  - src/implementations/payment/checkout.ts
  - src/implementations/payment/session-replays.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/follow.ts
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
  - docs/3.customers-and-cards.md
journeys:
  - hosted-session
  - hosted-refused
  - hosted-saved-card
---

# Checkout

An application module sends the payer to a Hosted Payments Page with `CreateCheckoutSession` and reads the outcome with `GetCheckoutSession`.

## Sub-features

Each journey says where it runs; [README](README.md) explains the two targets.

- `hosted-session` (stand-in only): the page is requested with the amount, currency, reference, billing country and return URLs (the cancel URL doubling as failure URL), reads `pending` until the payer pays it, then carries the payment Checkout.com produced and that payment's status; a replay of the key returns the same page without a second request. Only a payer in a browser pays a hosted page, so the stand-in plays the payer.
- `hosted-refused` (sandbox, then stand-in): without `checkoutBillingCountry` the call is a `PaymentError` naming it; an unknown session is `PaymentNotFoundError`. On the stand-in the log also shows no hosted page requested.
- `hosted-saved-card` (stand-in only): a session with `customer` and `savePaymentMethod` asks the page to store the card (`payment_method_configuration.card.store_payment_details: "enabled"`), as a Recurring payment with 3-D Secure asking for the mandate (`challenge_requested_mandate`). Once the payer pays it, `GetCheckoutSession` reads the payment (`LoadPayment`) and records the card on the customer: `ListPaymentMethods` returns it, and the customer's metadata at Checkout.com holds `antelope_method_<src_…>` = `<pay_…> <saved at, epoch ms>` for the hosted payment. An `offSession` charge of that card is merchant-initiated and carries `previous_payment_id` of the hosted payment. The payer paying the page is the stand-in's lever.

## How to get to it (user POV)

- A module that calls `CreateCheckoutSession(request, idempotencyKey)` and redirects the payer to `redirectUrl`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" checkout
```

## Gotchas

- A replay is recognised in-process only (docs/3.customers-and-cards.md); the journeys do not restart the module between the two calls.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
