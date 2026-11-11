---
covers:
  - src/config.ts
  - src/index.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/guards.ts
  - src/implementations/payment/http.ts
  - src/implementations/payment/json.ts
  - src/implementations/payment/index.ts
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

Each journey says where it runs; [README](README.md) explains the two targets.

- `account-selection` (sandbox, then stand-in): a call naming `secondary` runs on that account: the provider holds its saving payment with the secondary account's `Unscheduled` payment type, which only that account declares. An account that is not configured is a `PaymentError`; on the stand-in the log also shows no request for it.
- `bad-key` (sandbox, then stand-in): a secret key Checkout.com refuses is a `PaymentError`, so the caller retries instead of seeing a payment. On the stand-in the log shows the 401.

## How to get to it (user POV)

- An operator who adds `accounts: { secondary: { ... } }` to the module config.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" accounts
```

## Gotchas

- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
