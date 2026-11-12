<a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration src="./.github/readme/strip.svg" width="100%" alt="PROVIDER · CHECKOUT COM: part of AntelopeJS, hexagonal architecture beyond your own code. A glowing button reads Star AntelopeJS."></a>

<div align="center">

# `@antelopejs/checkout-com`

<a href="https://www.npmjs.com/package/@antelopejs/checkout-com"><img data-illustration alt="npm" src="https://img.shields.io/npm/v/@antelopejs/checkout-com?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/checkout-com?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="https://discord.gg/g4pFt6eXqu"><img data-illustration alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a> <a href="./docs"><img data-illustration alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a> <a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration alt="Star AntelopeJS" src="https://img.shields.io/github/stars/AntelopeJS/antelopejs?label=Star%20AntelopeJS&style=for-the-badge&labelColor=000000&color=000000&logo=github"></a>

**The Checkout.com provider for AntelopeJS. It implements portable payments on the Checkout.com unified Payments API.**

[Documentation](#documentation) · [Interfaces](#interfaces) · [All interfaces and providers](https://github.com/AntelopeJS/antelopejs#ecosystem)

</div>

Checkout.com payments for AntelopeJS. This module implements
`@antelopejs/interface-payment` on Checkout.com's unified Payments API. It
covers hosted checkout, direct payments with authorize and capture, refunds,
saved cards charged off-session, and signed webhooks.

## Install

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

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                         | Supported        | Tested with |
| ------------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-core`    | `>=0.0.5 <1.0.0` | `0.4.0`     |
| `@antelopejs/interface-payment` | `>=0.2.0 <0.3.0` | `0.2.0`     |

<!-- antelopejs-docs-compat:end -->

## Part of AntelopeJS

This package belongs to [AntelopeJS](https://github.com/AntelopeJS/antelopejs), the TypeScript framework where modules depend on contracts and the application chooses the provider. The open-source back office [AntelopeJS DMS](https://github.com/AntelopeJS/dms) is built on it.

<!-- antelopejs-framework-modules:start -->

| Area         | Contracts                                                                                                                                                                                                                                                                                                                                                                                                                  | Providers                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | [`interface-api`](https://github.com/AntelopeJS/interface-api) · [`interface-api-util`](https://github.com/AntelopeJS/interface-api-util) · [`interface-data-api`](https://github.com/AntelopeJS/interface-data-api)                                                                                                                                                                                                       | [`api`](https://github.com/AntelopeJS/api)                                                                                                                                                                |
| Auth         | [`interface-auth`](https://github.com/AntelopeJS/interface-auth)                                                                                                                                                                                                                                                                                                                                                           | [`auth-jwt`](https://github.com/AntelopeJS/auth-jwt)                                                                                                                                                      |
| Database     | [`interface-database`](https://github.com/AntelopeJS/interface-database) · [`interface-database-decorators`](https://github.com/AntelopeJS/interface-database-decorators) · [`interface-database-catalog`](https://github.com/AntelopeJS/interface-database-catalog) · [`interface-mongodb`](https://github.com/AntelopeJS/interface-mongodb) · [`interface-rethinkdb`](https://github.com/AntelopeJS/interface-rethinkdb) | [`postgres`](https://github.com/AntelopeJS/postgres) · [`mongodb`](https://github.com/AntelopeJS/mongodb) · [`rethinkdb`](https://github.com/AntelopeJS/rethinkdb)                                        |
| Redis        | [`interface-redis`](https://github.com/AntelopeJS/interface-redis) · [`interface-redis-scheduler`](https://github.com/AntelopeJS/interface-redis-scheduler)                                                                                                                                                                                                                                                                | [`redis`](https://github.com/AntelopeJS/redis)                                                                                                                                                            |
| Email        | [`interface-email`](https://github.com/AntelopeJS/interface-email)                                                                                                                                                                                                                                                                                                                                                         | [`nodemailer`](https://github.com/AntelopeJS/nodemailer) · [`brevo`](https://github.com/AntelopeJS/brevo)                                                                                                 |
| File storage | [`interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage)                                                                                                                                                                                                                                                                                                                                           | [`file-storage-local`](https://github.com/AntelopeJS/file-storage-local) · [`file-storage-s3`](https://github.com/AntelopeJS/file-storage-s3)                                                             |
| Payments     | [`interface-payment`](https://github.com/AntelopeJS/interface-payment) · [`interface-subscriptions`](https://github.com/AntelopeJS/interface-subscriptions) · [`interface-stripe`](https://github.com/AntelopeJS/interface-stripe)                                                                                                                                                                                         | [`stripe`](https://github.com/AntelopeJS/stripe) · [`mollie`](https://github.com/AntelopeJS/mollie) · **`checkout-com`** · [`payment-subscriptions`](https://github.com/AntelopeJS/payment-subscriptions) |

<!-- antelopejs-framework-modules:end -->

## License

This project uses the Apache License 2.0. The [LICENSE](LICENSE) file has the
full text.
