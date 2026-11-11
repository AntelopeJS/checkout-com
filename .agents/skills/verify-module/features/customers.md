---
covers:
  - src/implementations/payment/customers.ts
  - src/implementations/payment/payments.ts
  - src/implementations/payment/follow.ts
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

Each journey says where it runs; [README](README.md) explains the two targets.

- `customer-lifecycle` (sandbox, then stand-in): a customer needs an email, keeps its name and metadata, reads back without the module's own bookkeeping, has its email kept unique, and is gone after `DeleteCustomer`, both through core and at the provider.
- `saved-card` (sandbox, then stand-in): a payment with `savePaymentMethod` comes back `requires_action`, because Checkout.com sends every 3-D Secure payment through the payer's browser, and the provider holds it as the `Recurring` start of a series. On the sandbox the payer's browser is the headless one `CKO_BROWSER` names; on the stand-in a plain visit authenticates. Once the payer has opened the redirect, `GetPayment` reads it `succeeded` with the card stored as an instrument that `ListPaymentMethods` returns. An `offSession` charge is captured as a `Recurring` payment, the customer's record at Checkout.com holds the chain under `antelope_method_<src_…>`, and `DetachPaymentMethod` empties the list. On the sandbox the provider shows the charge as merchant-initiated. On the stand-in the log also shows the saving payment customer-initiated, storing the card and asking 3-D Secure for the mandate, and the charge chained by `previous_payment_id` with no 3-D Secure; the sandbox shows none of these.

## How to get to it (user POV)

- A module that calls `CreateCustomer`, `ListPaymentMethods` and `CreatePayment` with `offSession` for a subscription renewal.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" customers
```

## Gotchas

- Without `CKO_BROWSER`, `saved-card` ends NOT VERIFIED at the redirect: the sandbox runs 3-D Secure in the page's script, which a plain request does not.
- The sandbox refuses the all-zero customer id `cus_000…` as an invalid request (422) rather than answering 404, so the journeys name an unknown customer with another well-formed id.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
