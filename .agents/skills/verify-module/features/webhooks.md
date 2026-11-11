---
covers:
  - src/implementations/payment/webhooks.ts
  - src/implementations/payment/signature.ts
  - src/implementations/payment/accounts.ts
  - src/implementations/payment/errors.ts
  - src/implementations/payment/follow.ts
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
  - docs/4.webhooks.md
journeys:
  - webhook-signature
  - webhook-events
---

# Webhooks

An application route hands Checkout.com's raw delivery to `VerifyWebhook` and gets a normalised event or a refusal.

## Sub-features

Each journey says where it runs; [README](README.md) explains the two targets.

- `webhook-signature` (sandbox, then stand-in): a delivery signed with HMAC-SHA256 over the raw body under the account's key becomes an event for a payment captured on the target; an altered body, a missing signature, a non-hex signature and a signature under another account's key are `WebhookVerificationError`; an account configured with `webhookAuthorization` also needs that value back. A digest in upper-case hex and one with surrounding whitespace are accepted; a 62- and a 66-hex-digit digest are refused; on the secondary account a wrong `Authorization` value, a prefix of the right one and the right one with a trailing space are each refused. The secondary account uses the same keys as the default one and its own webhook settings. This is the end-to-end view through core: the predicate itself is covered by the module's own tests.
- `webhook-events` (sandbox, then stand-in): `payment_refunded` is `refund.succeeded`, `payment_declined` is `payment.failed` with the payment read back, an unmapped event type yields no event, `payment_approved` for a payment the module created with automatic capture yields no event (the capture's own event follows), and `payment_approved` for an `authorizeOnly` payment is `payment.authorized` with the payment read back. Each approval carries the metadata the provider holds for the payment, as Checkout.com's delivery does.

## How to get to it (user POV)

- A consumer route that passes `{ body, headers }` of Checkout.com's workflow webhook to `VerifyWebhook(request, provider?)`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" webhooks
```

## Gotchas

- The JSON driver cannot carry bytes, so the journeys pass the raw body as a string; the HMAC and the parse are the same for the ASCII bodies Checkout.com sends.
- The deliveries are signed by the journey, not sent by a Checkout.com workflow: the sandbox holds the payments they name, but no journey receives a real delivery.
- A stand-in pass proves agreement with the stand-in's reading of Checkout.com's documentation (`src/test/standin`, built to `dist/test/standin`); a sandbox pass proves the module against the merchant's sandbox. Step names start with `sandbox:` or `stand-in:`.
