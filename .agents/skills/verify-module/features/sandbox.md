---
covers:
  - src/implementations/payment/http.ts
docs:
  - README.md
  - docs/5.testing.md
journeys:
  - request-contract
---

# Sandbox

The outbound client against the real Checkout.com: the requests it builds reach the configured base URL under the secret key, and the merchant's sandbox accepts them.

## Sub-features

- `request-contract` (sandbox, then stand-in): on the sandbox, a `CreatePayment` through core returns a payment that the sandbox, read with the secret key at the configured base URL, holds captured with the same id, amount, currency and reference; `GetPayment` reads it `succeeded`. A wrong URL, key or body leaves nothing to read back. On the stand-in, which logs requests, the payment is the only `POST /payments`, answered 201 or 202 (the stand-in answers 401 to any key but its secret key), as a JSON object carrying the amount, currency, reference and the configured processing channel. The sandbox does not show which processing channel a payment came through, so that check runs on the stand-in only.

## How to get to it (user POV)

- A merchant who runs the module with a sandbox key and the merchant-specific base URL.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" sandbox
```

## Gotchas

- `sandbox-live` is gone. It stood for the missing live run and always read NOT VERIFIED. `saas` in `verify.config.ts` now plays that part for every journey: a run without the sandbox keys is NOT VERIFIED throughout. `request-contract` makes the one payment on the sandbox and reads it back that `sandbox-live` described.
- The sandbox target refuses a secret key that is not `sk_sbox_`, a public key that is not `pk_sbox_` and a base URL off `*.api.sandbox.checkout.com`, so no journey reaches production.
- Evidence never holds a key or the merchant's base URL: provider reads use plain `fetch`, not `context.http`; checks compare picked fields only, since a provider body's `_links` carry the merchant's host; and the payer's browser runs with its output discarded, since the page 3-D Secure ends on is served from that host.
