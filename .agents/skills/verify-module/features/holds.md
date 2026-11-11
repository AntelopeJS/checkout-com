---
covers:
  - src/implementations/payment/payments.ts
  - src/implementations/payment/follow.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
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
  - docs/2.payments.md
journeys:
  - hold-capture
  - hold-cancel
  - hold-settle-budget
---

# Holds

An application module authorizes first and settles later: `CapturePayment` or `CancelPayment` on a payment created with `authorizeOnly`.

## Sub-features

- `hold-capture`: an `authorizeOnly` payment reads `authorized` with nothing captured and was asked of Checkout.com with `capture: false`; a partial capture reaches Checkout.com under the caller's key and the payment ends `succeeded` with that amount; capturing a payment Checkout.com captures by itself is `InvalidPaymentStateError` and sends nothing.
- `hold-cancel`: cancelling a hold sends one void and the payment reads `canceled` (Checkout.com holds it as voided); cancelling a payment waiting for 3-D Secure is `InvalidPaymentStateError`, from the 422 `no_balance_available_to_void` Checkout.com answers to the void (the sandbox's answer; its documentation shows a 403, which the module maps the same way).
- `hold-settle-budget`: on an account with `settleTimeoutMs: 0`, `CapturePayment` of a hold sends one capture and returns the payment as Checkout.com last reported it (still `authorized`, nothing captured) instead of waiting for the capture to show; once the stand-in has applied the capture, `GetPayment` reads `succeeded` with the whole amount captured. `hold-capture`, on the default budget, is the contrast: its capture call already returns the applied amount.

## How to get to it (user POV)

- A module that calls `CapturePayment(id, idempotencyKey, amount?)` or `CancelPayment(id, idempotencyKey)` once the order is confirmed or abandoned.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" holds
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
