---
covers:
docs:
  - README.md
  - docs/5.testing.md
journeys:
  - module-dev
  - request-contract
---

# Smoke

The fixed journeys every verdict runs: load the module as `local`, charge one card on the merchant's Checkout.com sandbox and read the payment back.

## Sub-features

- `module-dev` is the pack's journey: the project answers, the consumer loads the payment interface, Ctrl+C exits 130. Its config points nowhere, so it calls no provider.
- `request-contract` (sandbox, then stand-in): one `CreatePayment` through core lands on the account behind the configured base URL and secret key, which holds it captured with the amount, currency and reference sent, and `GetPayment` reads it `succeeded`. On the stand-in it is also the only `POST /payments`, answered 201 or 202, carrying the processing channel. See [sandbox](sandbox.md).

## How to get to it (user POV)

- A project with `@antelopejs/checkout-com` and a module that imports `@antelopejs/interface-payment`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" smoke
```

## Gotchas

- The smoke feature covers no glob, so it never marks a file as mapped.
- Without the sandbox keys in the environment of `new`, both journeys are NOT VERIFIED, `module-dev` included: the harness gates every journey on `saas.env`.
