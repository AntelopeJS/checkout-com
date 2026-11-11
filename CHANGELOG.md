# Changelog

## v0.1.0


### 🚀 Enhancements

- Implement interface-payment on Checkout.com ([2f57578](https://github.com/AntelopeJS/checkout-com/commit/2f57578))
- **webhooks:** Report declined captures, voids and failed authentications ([#50](https://github.com/AntelopeJS/checkout-com/pull/50))

### 🔥 Performance

- **refunds:** Read the payment and its actions together in GetRefund ([#55](https://github.com/AntelopeJS/checkout-com/pull/55))

### 🩹 Fixes

- Refuse what the contract refuses, test replayed actions ([7f025bc](https://github.com/AntelopeJS/checkout-com/commit/7f025bc))
- **verify:** List each feature's runtime imports in its covers ([#35](https://github.com/AntelopeJS/checkout-com/pull/35))
- **refunds:** Report an over-refund as InvalidPaymentStateError ([#45](https://github.com/AntelopeJS/checkout-com/pull/45))
- **errors:** Report refused captures and voids as InvalidPaymentStateError ([#54](https://github.com/AntelopeJS/checkout-com/pull/54))
- **saved-methods:** Record a card saved through 3DS ([#40](https://github.com/AntelopeJS/checkout-com/pull/40))
- **saved-methods:** Keep every record when one customer saves cards at once ([#42](https://github.com/AntelopeJS/checkout-com/pull/42))
- **saved-methods:** Prune a detached card's record ([#52](https://github.com/AntelopeJS/checkout-com/pull/52))
- **saved-methods:** Make a card the customer's only once its payer authenticated it ([#57](https://github.com/AntelopeJS/checkout-com/pull/57))

### 💅 Refactors

- Clean the repo with the guardrail pack ([#5](https://github.com/AntelopeJS/checkout-com/pull/5))

### 📖 Documentation

- Document the module, its mapping and its stand-in ([9a39cac](https://github.com/AntelopeJS/checkout-com/commit/9a39cac))
- Capture and cancel refusals, refund not-found, hosted saves from webhooks ([cb2f6a2](https://github.com/AntelopeJS/checkout-com/commit/cb2f6a2))
- **agents:** Simplify repository guidance ([#2](https://github.com/AntelopeJS/checkout-com/pull/2))
- **github:** Send questions and ideas to Discord ([#23](https://github.com/AntelopeJS/checkout-com/pull/23))
- **config:** Say settleTimeoutMs follows captures and voids only ([#36](https://github.com/AntelopeJS/checkout-com/pull/36))
- **agents:** Give the interface-payment range package.json uses ([#56](https://github.com/AntelopeJS/checkout-com/pull/56))

### 📦 Build

- **deps:** Adopt @antelopejs/interface-payment 0.1.0 ([#8](https://github.com/AntelopeJS/checkout-com/pull/8))
- **deps:** Adopt @antelopejs/interface-subscriptions 0.1.0 ([#9](https://github.com/AntelopeJS/checkout-com/pull/9))
- **deps:** Bump @antelopejs/tooling-configs to 0.2.17 ([#15](https://github.com/AntelopeJS/checkout-com/pull/15))
- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#32](https://github.com/AntelopeJS/checkout-com/pull/32))
- **deps:** Bump @antelopejs/tooling-configs to 0.3.4 ([#33](https://github.com/AntelopeJS/checkout-com/pull/33))
- Type-check dependency declarations in typecheck, not in build ([#34](https://github.com/AntelopeJS/checkout-com/pull/34))
- **deps:** Bump @antelopejs/tooling-configs to 0.4.0 ([#37](https://github.com/AntelopeJS/checkout-com/pull/37))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#38](https://github.com/AntelopeJS/checkout-com/pull/38))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#39](https://github.com/AntelopeJS/checkout-com/pull/39))

### 🏡 Chore

- Adopt the guardrail pack from tooling-configs 0.2.0 ([#3](https://github.com/AntelopeJS/checkout-com/pull/3))
- Configure Renovate with the shared preset ([#4](https://github.com/AntelopeJS/checkout-com/pull/4))
- Land the cleanup campaign on main ([#28](https://github.com/AntelopeJS/checkout-com/pull/28))
- **verify:** Remove seeded runs from the verification skill ([#29](https://github.com/AntelopeJS/checkout-com/pull/29))
- **ci:** Remove the weekly mutation caller ([#30](https://github.com/AntelopeJS/checkout-com/pull/30))
- **release:** Prepare the package for its first public release ([#58](https://github.com/AntelopeJS/checkout-com/pull/58))

### ✅ Tests

- **skills:** Add trigger and answer cases for the checkout-com skill ([#47](https://github.com/AntelopeJS/checkout-com/pull/47))
- **live:** Skip refund tests with a stated reason when the sandbox has no balance ([#43](https://github.com/AntelopeJS/checkout-com/pull/43))
- **formal:** Check the webhook acceptance predicate ([#49](https://github.com/AntelopeJS/checkout-com/pull/49))
- **standin:** Refuse a refund on request, not for an amount of 3738 ([#44](https://github.com/AntelopeJS/checkout-com/pull/44))
- **idempotency:** Drive two concurrent payments under one key ([#46](https://github.com/AntelopeJS/checkout-com/pull/46))
- **standin:** Drop amount rules the sandbox does not enforce ([#41](https://github.com/AntelopeJS/checkout-com/pull/41))
- **formal:** Check the saved-method chain under any interleaving ([#51](https://github.com/AntelopeJS/checkout-com/pull/51))
- **verify:** Make the feature map and journeys prove what they claim ([#48](https://github.com/AntelopeJS/checkout-com/pull/48))
- **verify:** Run the journeys against the Checkout.com sandbox when its keys are set ([#53](https://github.com/AntelopeJS/checkout-com/pull/53))

### 🤖 CI

- Call ci-node.yml@v1 ([#31](https://github.com/AntelopeJS/checkout-com/pull/31))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Thomasims <thomas@antelopejs.com>

