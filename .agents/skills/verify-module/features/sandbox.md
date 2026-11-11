---
covers:
  - src/implementations/payment/http.ts
docs:
  - README.md
  - docs/5.testing.md
journeys:
  - request-contract
  - sandbox-live
---

# Sandbox

What only the real Checkout.com can show: that the requests the client builds are accepted by the merchant's sandbox.

## Sub-features

- `request-contract`: runs on the stand-in and can PASS. Exactly one `POST /payments` reaches the stand-in this run configured as `baseUrl`, answered 201 or 202 (the stand-in answers 401 to any key but the configured secret key, so a success proves the key), as a JSON object carrying the amount, currency, reference and the configured processing channel: the one leg of the contract a stand-in can check.
- `sandbox-live`: always NOT VERIFIED. No journey reaches Checkout.com's sandbox: it needs the merchant's `sk_sbox_` key, processing channel and base URL. A verdict that requires this feature therefore reads NOT VERIFIED, never PASS. The smoke feature leaves it out so a diff that touches no client code is judged on the stand-in journeys.

## How to get to it (user POV)

- A merchant who runs the module with a sandbox key.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" sandbox
```

## Gotchas

- The stand-in journeys of the other features stand for Checkout.com's documented answers, not for its live behaviour. Where the documentation is silent the stand-in chose, and those choices are the first thing a live run checks (docs/5.testing.md).
