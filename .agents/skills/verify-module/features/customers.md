---
covers:
  - src/implementations/payment/customers.ts
  - src/implementations/payment/saved-methods.ts
  - src/implementations/payment/mapping.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/guards.ts
  - src/implementations/payment/http.ts
  - src/implementations/payment/ids.ts
  - src/implementations/payment/json.ts
  - src/implementations/payment/lookup.ts
  - src/implementations/payment/resources.ts
  - src/index.ts
  - src/config.ts
  - src/implementations/payment/index.ts
docs:
  - README.md
  - docs/3.customers-and-cards.md
journeys:
  - customer-lifecycle
  - saved-card
---

# Customers

An application module keeps customers and their saved cards, and charges a saved card without the payer.

## Sub-features

- `customer-lifecycle`: a customer needs an email, keeps its name and metadata, reads back without the module's own bookkeeping, has its email kept unique, and is gone after `DeleteCustomer`.
- `saved-card`: a payment with `savePaymentMethod` stores the card as an instrument that `ListPaymentMethods` returns, starts the series customer-initiated with the mandate asked of 3-D Secure, an `offSession` charge is merchant-initiated, Recurring and chained to the saving payment, Checkout.com's customer record holds the chain under `antelope_method_<src_…>`, and `DetachPaymentMethod` empties the list.

## How to get to it (user POV)

- A module that calls `CreateCustomer`, `ListPaymentMethods` and `CreatePayment` with `offSession` for a subscription renewal.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" customers
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
