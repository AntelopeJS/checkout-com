# Feature map

One file per feature. `covers:` lists the source files its journeys run through: the module's load path (`src/index.ts`, `src/config.ts`, the payment barrel and their runtime imports) and each runtime import of the feature's entry file, `docs:` the pages a verdict judges, and `journeys:` the journeys it runs. `pnpm exec antelopejs-verify map` checks that every user-facing file is covered.

Checkout.com is stood in for by the module's own test stand-in (`src/test/standin`, built to `dist/test/standin` by `pnpm run build`): an HTTP server that answers the part of Checkout.com's API the module uses from the examples in its documentation, with the sandbox's test cards, `Cko-Idempotency-Key` handling, asynchronous captures, voids and refunds, and a log of every call. Each journey starts a fresh one, points the module's `baseUrl` at it and reads what the provider holds with the secret key as a second view, next to what the module returned. A pass proves the module agrees with that reading of the documentation and nothing more; `sandbox-live`, in the `sandbox` feature, is the journey that would reach the real service, and it always reads NOT VERIFIED.

| Feature | What the user does | Journeys |
|---|---|---|
| [payments](payments.md) | Charges a card token and reads the payment back. | pay-approved, pay-declined, pay-idempotent, pay-3ds |
| [holds](holds.md) | Authorizes, then captures or cancels. | hold-capture, hold-cancel |
| [refunds](refunds.md) | Refunds all or part of a payment. | refund-flow, refund-declined |
| [customers](customers.md) | Keeps customers and saved cards, charges a saved card off-session. | customer-lifecycle, saved-card |
| [checkout](checkout.md) | Sends the payer to a hosted payment page. | hosted-session, hosted-refused |
| [webhooks](webhooks.md) | Verifies Checkout.com's signed deliveries. | webhook-signature, webhook-events |
| [accounts](accounts.md) | Selects one of several Checkout.com accounts. | account-selection, bad-key |
| [sandbox](sandbox.md) | Sends a payment request that the stand-in checks (`request-contract`), and would reach the real Checkout.com (`sandbox-live`, always NOT VERIFIED). | request-contract, sandbox-live |
| [smoke](smoke.md) | The fixed journey every verdict runs. | module-dev, pay-through-stand-in |
