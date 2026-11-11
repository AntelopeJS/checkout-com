---
name: checkout-com
description: The AntelopeJS Checkout.com module — implements @antelopejs/interface-payment on Checkout.com's unified Payments API (hosted payments page, direct payments with 3DS redirects, authorize/capture, refunds, saved cards charged as merchant-initiated transactions, HMAC-signed workflow webhooks). Use when wiring "@antelopejs/checkout-com" into a project, configuring its keys, processing channel, base URL or webhook keys, adding subscriptions on Checkout.com, or debugging a Checkout.com payment, decline, refund or webhook through the payment interface.
category: antelopejs-module
tags: [payment, checkout.com, checkout, webhook, antelopejs]
---

# checkout-com

Implements the payment interface on Checkout.com. Consumers code against
`@antelopejs/interface-payment` (see its skill); this module is what you wire.

## Wiring

```ts
modules: {
  payments: {
    source: { type: "package", package: "@antelopejs/checkout-com" },
    config: {
      secretKey: "sk_sbox_…",
      processingChannelId: "pc_…",
      baseUrl: "https://{prefix}.api.sandbox.checkout.com", // from the Dashboard
      webhookSignatureKey: "…",        // the workflow webhook action's key
      checkoutBillingCountry: "FR",    // needed for hosted checkout
    },
  },
}
```

Optional: `webhookAuthorization`, `merchantInitiatedType` (`Recurring` |
`Unscheduled`), `accounts` (more accounts for the trailing `provider`
argument), `timeoutMs`, `settleTimeoutMs`. No Redis, no API module.

For subscriptions, wire `@antelopejs/payment-subscriptions` beside it:
Checkout.com has no subscription resource.

## What differs from Stripe

- `paymentMethod` is a Frames/Flow token (`tok_…`) or a saved instrument
  (`src_…`). `CreatePayment` without one is refused.
- `CreateCustomer` needs an `email`; emails are unique per account.
- `CreateCheckoutSession` replays are recognised in-process only.
- A payment captured automatically reads `pending` until Checkout.com has
  captured it; `authorized` means an `authorizeOnly` hold.
  `CapturePayment` refuses anything but an `authorizeOnly` payment
  (`automatic_capture`), and a 3DS-pending payment cannot be cancelled.
- Every payment asking for 3DS, a saving payment always, comes back
  `requires_action`, even for a frictionless card; `GetPayment` keeps
  `requires_action` and `redirectUrl` until the payer is past 3DS.
- A card saved through 3DS is recorded on the first `GetPayment` or payment
  webhook after authentication (`antelope_save_for` marker).
- Refunds come back `pending`; the webhook settles them. Refund ids are
  `<pay_…>:<act_…>` — opaque.
- Off-session charges are merchant-initiated and chained (`previous_payment_id`)
  to the payment that saved the card, recorded in the customer's metadata
  (`antelope_method_…`). Customers have 20 metadata pairs in all.
- Amounts go out unchanged. Checkout.com's docs ask three-decimal currencies to
  end in 0 and CLP in 00, but the sandbox accepts any whole amount; a refusal
  surfaces as `PaymentError` (`amount_invalid`).

## Webhooks

Create a workflow whose webhook action has a signature key (and optionally an
`Authorization` header); subscribe the `payment_*` events, including
`payment_capture_declined`, `payment_void_declined` and
`payment_authentication_failed`, and `dispute_received`. A declined capture or
void reports the hold it leaves (`payment.authorized`). Call `VerifyWebhook({ body: rawBody, headers })` from your
route. Payment events read the payment back from the API, so `VerifyWebhook` can
reject with a plain `PaymentError` during an outage — answer 5xx and
Checkout.com retries. No timestamp is signed: de-duplicate on `event.id`.

## Debugging

- 403 `base_url_invalid`: set `baseUrl` to the merchant-specific URL.
- A charge refused as an unknown payment method: the id is not `tok_`/`src_`, or
  the instrument was deleted (`DetachPaymentMethod`, `DeleteCustomer`).
- `failure.providerCode` is Checkout.com's response code (20051 insufficient
  funds, 20154 3DS required, …).
- A saved card with `createdAt` 0 was not saved through this module (or the
  customer's metadata was full): its charges carry no chain.

## Testing

`pnpm test` runs against a stand-in built from Checkout.com's documentation.
Set `CKO_SECRET_KEY` and `CKO_PROCESSING_CHANNEL_ID` (plus `CKO_BASE_URL`, and
`CKO_PUBLIC_KEY` for the charge tests) to run the same suite against the
sandbox. See `docs/5.testing.md`.
