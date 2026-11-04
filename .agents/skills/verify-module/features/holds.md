---
covers:
  - src/implementations/payment/payments.ts
  - src/implementations/payment/follow.ts
docs:
  - README.md
  - docs/2.payments.md
journeys:
  - hold-capture
  - hold-cancel
---

# Holds

An application module authorizes first and settles later: `CapturePayment` or `CancelPayment` on a payment created with `authorizeOnly`.

## Sub-features

- `hold-capture`: an `authorizeOnly` payment reads `authorized` with nothing captured and was asked of Checkout.com with `capture: false`; a partial capture reaches Checkout.com under the caller's key and the payment ends `succeeded` with that amount; capturing a payment Checkout.com captures by itself is `InvalidPaymentStateError` and sends nothing.
- `hold-cancel`: cancelling a hold sends one void and the payment reads `canceled` (Checkout.com holds it as voided); cancelling a payment waiting for 3-D Secure is `InvalidPaymentStateError`, from the 403 Checkout.com answers to the void.

## How to get to it (user POV)

- A module that calls `CapturePayment(id, idempotencyKey, amount?)` or `CancelPayment(id, idempotencyKey)` once the order is confirmed or abandoned.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" holds
```

## Gotchas

- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
