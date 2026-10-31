---
covers:
  - src/implementations/payment/webhooks.ts
  - src/implementations/payment/signature.ts
docs:
  - README.md
  - docs/4.webhooks.md
journeys:
  - webhook-signature
  - webhook-events
---

# Webhooks

An application route hands Checkout.com's raw delivery to `VerifyWebhook` and gets a normalised event or a refusal.

## Sub-features

- `webhook-signature`: a delivery signed with HMAC-SHA256 over the raw body under the account's key becomes an event; an altered body, a missing signature, a non-hex signature and a signature under another account's key are `WebhookVerificationError`; an account configured with `webhookAuthorization` also needs that value back.
- `webhook-events`: `payment_refunded` is `refund.succeeded`, `payment_declined` is `payment.failed` with the payment read back, and an unmapped event type yields no event.

## How to get to it (user POV)

- A consumer route that passes `{ body, headers }` of Checkout.com's workflow webhook to `VerifyWebhook(request, provider?)`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" webhooks
```

## Gotchas

- The JSON driver cannot carry bytes, so the journeys pass the raw body as a string; the HMAC and the parse are the same for the ASCII bodies Checkout.com sends.
- The Checkout.com side is the module's own stand-in (`src/test/standin`, built to `dist/test/standin`), so a feature proves agreement with its reading of the documentation, not with the live service; see [sandbox](sandbox.md).
