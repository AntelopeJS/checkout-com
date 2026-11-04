---
covers:
  - src/config.ts
  - src/index.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
docs:
  - README.md
  - docs/1.introduction.md
journeys:
  - account-selection
  - bad-key
---

# Accounts

An operator configures several Checkout.com accounts, and a call picks one with the trailing `provider` argument.

## Sub-features

- `account-selection`: a call naming `secondary` runs on that account, whose off-session charges are declared Unscheduled; an account that is not configured is a `PaymentError` and sends nothing.
- `bad-key`: a secret key Checkout.com refuses with 401 is a `PaymentError`, so the caller retries instead of seeing a payment.

## How to get to it (user POV)

- An operator who adds `accounts: { secondary: { ... } }` to the module config.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" accounts
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
