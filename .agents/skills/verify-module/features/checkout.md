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

- `hosted-session`: the page is requested with the amount, currency, reference, billing country and return URLs (the cancel URL doubling as failure URL), reads `pending` until the payer pays it, then carries the payment Checkout.com produced and that payment's status; a replay of the key returns the same page without a second request.
- `hosted-refused`: without `checkoutBillingCountry` the call is a `PaymentError` naming it and sends nothing; an unknown session is `PaymentNotFoundError`.
- `hosted-saved-card`: a session with `customer` and `savePaymentMethod` asks the page to store the card (`payment_method_configuration.card.store_payment_details: "enabled"`), as a Recurring payment with 3-D Secure asking for the mandate (`challenge_requested_mandate`). Once the payer pays it, `GetCheckoutSession` reads the payment (`LoadPayment`) and records the card on the customer: `ListPaymentMethods` returns it, and the customer's metadata at Checkout.com holds `antelope_method_<src_…>` = `<pay_…> <saved at, epoch ms>` for the hosted payment. An `offSession` charge of that card is merchant-initiated and carries `previous_payment_id` of the hosted payment.

## How to get to it (user POV)

- A module that calls `CreateCheckoutSession(request, idempotencyKey)` and redirects the payer to `redirectUrl`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" checkout
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
- A replay is recognised in-process only (docs/3.customers-and-cards.md); the journeys do not restart the module between the two calls.
