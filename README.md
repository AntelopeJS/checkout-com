# @antelopejs/checkout-com

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/checkout-com"><img alt="NPM version" src="https://img.shields.io/npm/v/@antelopejs/checkout-com.svg?style=for-the-badge&labelColor=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/checkout-com.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
</div>

Checkout.com payments for AntelopeJS. Implements
`@antelopejs/interface-payment` on Checkout.com's unified Payments API: hosted
checkout, direct payments with authorize and capture, refunds, saved cards
charged off-session, and signed webhooks.

## Installation

```bash
ajs project modules add @antelopejs/checkout-com
```

## Interfaces

| Name    | Install command                  |                                                                  |
| ------- | -------------------------------- | ---------------------------------------------------------------- |
| Payment | `ajs module imports add payment` | [Documentation](https://github.com/AntelopeJS/interface-payment) |

There is no Checkout.com-specific interface: everything goes through the payment
interface.

### Subscriptions

Checkout.com has no subscription resource; the merchant fires every renewal.
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

| Field                    | Required            | Meaning                                                                                                                                                                              |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secretKey`              | Yes                 | Secret API key. `sk_sbox_…` is sandbox, `sk_…` production.                                                                                                                           |
| `processingChannelId`    | Yes                 | The processing channel every payment is made on.                                                                                                                                     |
| `baseUrl`                | No                  | The merchant-specific base URL from the Dashboard (_Developers_ › _Overview_). Without it the shared host of the key's environment is used, which Checkout.com documents as refused. |
| `webhookSignatureKey`    | For webhooks        | The signature key of the workflow's webhook action.                                                                                                                                  |
| `webhookAuthorization`   | No                  | The `Authorization` header value given to the workflow's webhook action. When set, deliveries without it are refused.                                                                |
| `merchantInitiatedType`  | No                  | `Recurring` (default) or `Unscheduled`: how saved cards and their off-session charges are declared to the card schemes.                                                              |
| `checkoutBillingCountry` | For hosted checkout | ISO 3166 country sent as the billing country of every hosted page, which Checkout.com requires.                                                                                      |
| `accounts`               | No                  | More accounts, keyed by the name callers pass as the interface's trailing `provider` argument. Each takes the fields above.                                                          |
| `timeoutMs`              | No                  | How long one HTTP call may take. Default 30 seconds.                                                                                                                                 |
| `settleTimeoutMs`        | No                  | How long a capture or void is followed until Checkout.com reports it applied. Default 10 seconds.                                                                                    |

Redis and an API module are not used. A consumer calls `VerifyWebhook` from its
own route.

## Behaviour worth knowing

- **Customers need an email.** Checkout.com requires one on every customer and
  keeps them unique; `CreateCustomer` without one is refused.
- **Hosted checkout is the Hosted Payments Page.** Replaying a
  `CreateCheckoutSession` key returns the first session only within one process:
  `/hosted-payments` takes no idempotency key.
- **Captures, voids and refunds are asynchronous** at Checkout.com. Capture and
  cancel wait up to `settleTimeoutMs` for the result; a refund is usually
  returned `pending`, and `refund.succeeded` follows by webhook.
- **A payment this module captures automatically** reads `pending` until
  Checkout.com has captured it, not `authorized`.
- **Saved cards are remembered on the customer.** The payment that stored a card
  is recorded in the customer's metadata (`antelope_method_…`) so that later
  off-session charges can name it as `previous_payment_id`. That record also
  dates the card: Checkout.com keeps no creation time for an instrument.

The [documentation](./docs) covers each of these, and what is verified only
against Checkout.com's documentation rather than a live account.

## Documentation

| Document                                                     | Contents                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [Introduction](./docs/1.introduction.md)                     | What maps to what, accounts, base URLs                     |
| [Payments](./docs/2.payments.md)                             | Direct payments, 3DS, authorize/capture, refunds, errors   |
| [Customers and saved cards](./docs/3.customers-and-cards.md) | Customers, instruments, the payment chain, hosted checkout |
| [Webhooks](./docs/4.webhooks.md)                             | Setting up the workflow, verification, the event mapping   |
| [Testing](./docs/5.testing.md)                               | The stand-in, running live, what each proves               |

## License

This project is licensed under the Apache License 2.0 - see the
[LICENSE](LICENSE) file for details.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                         | Supported                                                     | Tested with                                                   |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `@antelopejs/interface-core`    | `>=0.0.5 <1.0.0`                                              | `0.2.6`                                                       |
| `@antelopejs/interface-payment` | `file:.campaign/tgz/antelopejs-interface-payment-0f2509a.tgz` | `file:.campaign/tgz/antelopejs-interface-payment-0f2509a.tgz` |

<!-- antelopejs-docs-compat:end -->
