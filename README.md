# `@antelopejs/checkout-com`

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/checkout-com"><img data-illustration alt="NPM version" src="https://img.shields.io/npm/v/@antelopejs/checkout-com.svg?style=for-the-badge&labelColor=000000"></a>
<a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/checkout-com.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img data-illustration src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
</div>

Checkout.com payments for AntelopeJS. This module implements
`@antelopejs/interface-payment` on Checkout.com's unified Payments API. It
covers hosted checkout, direct payments with authorize and capture, refunds,
saved cards charged off-session, and signed webhooks.

## Installation

```bash
ajs project modules add @antelopejs/checkout-com
```

## Interfaces

| Name    | Install command                  |                                                                  |
| ------- | -------------------------------- | ---------------------------------------------------------------- |
| Payment | `ajs module imports add payment` | [Documentation](https://github.com/AntelopeJS/interface-payment) |

The module adds no Checkout.com-specific interface. Every call goes through the
payment interface.

### Subscriptions

Checkout.com has no subscription resource, so the merchant fires every renewal.
Wire `@antelopejs/payment-subscriptions` beside this module for
`@antelopejs/interface-subscriptions`. Each renewal it fires reaches Checkout.com
as a merchant-initiated `Recurring` payment chained to the payment that saved the
card.

## Configuration

```json
{
  "secretKey": "sk_sbox_…",
  "processingChannelId": "pc_…",
  "baseUrl": "https://{prefix}.api.sandbox.checkout.com",
  "webhookSignatureKey": "the workflow webhook action's signature key",
  "checkoutBillingCountry": "FR"
}
```

| Field                    | Required            | Meaning                                                                                                                                                                                                                  |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secretKey`              | Yes                 | Secret API key. `sk_sbox_…` is a sandbox key, and `sk_…` is a production key.                                                                                                                                            |
| `processingChannelId`    | Yes                 | The processing channel (`pc_…`) that every payment uses.                                                                                                                                                                 |
| `baseUrl`                | No                  | The merchant-specific base URL from the Dashboard (_Developers_ › _Overview_). Without it, the module uses the shared host of the key's environment, which Checkout.com documents as refused.                            |
| `webhookSignatureKey`    | For webhooks        | The signature key of the workflow's webhook action.                                                                                                                                                                      |
| `webhookAuthorization`   | No                  | The `Authorization` header value given to the workflow's webhook action. When it is set, `VerifyWebhook` refuses a delivery without it.                                                                                  |
| `merchantInitiatedType`  | No                  | `Recurring` (default) or `Unscheduled`. It is what the module declares to the card schemes for saved cards and their off-session charges.                                                                                |
| `checkoutBillingCountry` | For hosted checkout | The ISO 3166 alpha-2 country that the module sends as the billing country of every hosted page. Checkout.com requires one.                                                                                               |
| `accounts`               | No                  | More accounts, keyed by the name callers pass as the interface's trailing `provider` argument. Each account takes the fields above. `timeoutMs` and `settleTimeoutMs` are set once, at the top level, for every account. |
| `timeoutMs`              | No                  | How long one HTTP call may take, in milliseconds. Default `30000` (30 seconds).                                                                                                                                          |
| `settleTimeoutMs`        | No                  | How long, in milliseconds, the module reads a payment back after a capture or a void until Checkout.com reports it applied. Default `10000` (10 seconds).                                                                |

The module uses no Redis and no API module. A consumer calls `VerifyWebhook`
from its own route.

## Behaviour worth knowing

- **Customers need an email.** Checkout.com requires one on every customer and
  keeps emails unique. `CreateCustomer` without an email fails with
  `PaymentError`.
- **Hosted checkout is the Hosted Payments Page.** `/hosted-payments` takes no
  idempotency key, so a replayed `CreateCheckoutSession` key returns the first
  session only within one process.
- **Captures, voids, and refunds are asynchronous** at Checkout.com.
  `CapturePayment` and `CancelPayment` wait up to `settleTimeoutMs` for the
  result. A refund usually comes back `pending`, and `refund.succeeded` follows
  by webhook.
- **A payment that this module captures automatically** reads `pending`, not
  `authorized`, until Checkout.com has captured it.
- **Saved cards are remembered on the customer.** The module records the payment
  that stored a card in the customer's metadata (`antelope_method_…`), so later
  off-session charges can name it as `previous_payment_id`. That record also
  dates the card, because Checkout.com keeps no creation time for an instrument.

The [documentation](./docs) covers each of these. It also says which behaviour
the module checks only against Checkout.com's documentation, not against a live
account.

## Documentation

| Document                                                     | Contents                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| [Introduction](./docs/1.introduction.md)                     | What maps to what, accounts, base URLs                       |
| [Payments](./docs/2.payments.md)                             | Direct payments, 3DS, authorize and capture, refunds, errors |
| [Customers and saved cards](./docs/3.customers-and-cards.md) | Customers, instruments, the payment chain, hosted checkout   |
| [Webhooks](./docs/4.webhooks.md)                             | The workflow setup, verification, the event mapping          |
| [Testing](./docs/5.testing.md)                               | The stand-in, the live run, what each proves                 |

## License

This project uses the Apache License 2.0. The [LICENSE](LICENSE) file has the
full text.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                         | Supported        | Tested with |
| ------------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-core`    | `>=0.0.5 <1.0.0` | `0.4.0`     |
| `@antelopejs/interface-payment` | `>=0.2.0 <0.3.0` | `0.2.0`     |

<!-- antelopejs-docs-compat:end -->
