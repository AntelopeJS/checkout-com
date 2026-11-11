# Feature map

One file per feature. `covers:` lists the source files its journeys run through: the module's load path (`src/index.ts`, `src/config.ts`, the payment barrel and their runtime imports) and each runtime import of the feature's entry file, `docs:` the pages a verdict judges, and `journeys:` the journeys it runs. `pnpm exec antelopejs-verify map` checks that every user-facing file is covered.

## Where the journeys run

`verify.config.ts` declares `saas`: a run needs `CKO_SECRET_KEY`, `CKO_PUBLIC_KEY`, `CKO_PROCESSING_CHANNEL_ID` and `CKO_BASE_URL` in the environment of `new`, or every journey is NOT VERIFIED. docs/5.testing.md says how to load them. Each journey then runs on one or both of two targets:

- **Sandbox, then stand-in** (`onSandboxAndStandIn`). The journey loads the module against the merchant's Checkout.com sandbox, mints tokens with the public key and reads what the sandbox holds with the secret key. It then runs again against a fresh stand-in (`src/test/standin`, built to `dist/test/standin`). A check of what the module sent reads the stand-in's call log there. On the sandbox it reads the sandbox's own view of the same fact (`payment_type`, amount, currency, reference, balances, status and metadata from `GET /payments`; the saved-card record from the customer's metadata), or nothing where the sandbox shows none (`previous_payment_id`, the 3-D Secure request, the processing channel and idempotency key a request carried).
- **Stand-in only** (`onStandIn`). The journey needs a lever only the stand-in has: the payer completing or failing a challenge, the payer paying a hosted page, or an issuer refusing a refund.

The sandbox target refuses keys that are not `sk_sbox_` and `pk_sbox_` and a base URL off `*.api.sandbox.checkout.com`, and ends the journey NOT VERIFIED when the sandbox stops answering, answers 429 or 5xx, or a refund fails for want of balance (50003). Each step's name starts with `sandbox:` or `stand-in:`. A pass on the stand-in proves agreement with its reading of Checkout.com's documentation; a pass on the sandbox proves the module against the real service.

| Feature | What the user does | Sandbox, then stand-in | Stand-in only |
|---|---|---|---|
| [payments](payments.md) | Charges a card token and reads the payment back. | pay-approved, pay-declined, pay-idempotent | pay-3ds |
| [holds](holds.md) | Authorizes, then captures or cancels. | hold-capture, hold-cancel, hold-settle-budget | |
| [refunds](refunds.md) | Refunds all or part of a payment. | refund-flow | refund-declined |
| [customers](customers.md) | Keeps customers and saved cards, charges a saved card off-session. | customer-lifecycle, saved-card | |
| [checkout](checkout.md) | Sends the payer to a hosted payment page. | hosted-refused | hosted-session, hosted-saved-card |
| [webhooks](webhooks.md) | Verifies Checkout.com's signed deliveries. | webhook-signature, webhook-events | |
| [accounts](accounts.md) | Selects one of several Checkout.com accounts. | account-selection, bad-key | |
| [sandbox](sandbox.md) | Sends a payment request that lands on the configured account. | request-contract | |
| [smoke](smoke.md) | The fixed journeys every verdict runs. | request-contract | |

`module-dev`, the pack's journey in smoke, loads the module with `moduleConfig()` of `verify.config.ts`, which points nowhere: it proves the module loads and calls no provider.
