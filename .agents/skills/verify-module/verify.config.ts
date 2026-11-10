import type { VerifyConfig } from "@antelopejs/tooling-configs/verify";

import { accountJourneys } from "./journeys-accounts.ts";
import { checkoutJourneys } from "./journeys-checkout.ts";
import { customerJourneys } from "./journeys-customers.ts";
import { holdJourneys } from "./journeys-holds.ts";
import { paymentJourneys } from "./journeys-payments.ts";
import { refundJourneys } from "./journeys-refunds.ts";
import { sandboxJourneys } from "./journeys-sandbox.ts";
import { webhookJourneys } from "./journeys-webhooks.ts";

const config: VerifyConfig = {
  doors: {
    data: null,
    format: {
      globs: ["src/implementations/payment/saved-methods.ts", "src/implementations/payment/customers.ts", "src/implementations/payment/mapping.ts"],
      funnels: ["src/implementations/payment/saved-methods.ts"],
      why: "the module keeps the payment chain of every saved card in the customer's metadata at Checkout.com (`antelope_method_<src_…>` → `<pay_…> <saved at>`), and the capture and idempotency markers on payments: records written by this release are read by the next one",
    },
    contract: {
      globs: ["package.json", "src/config.ts"],
      funnels: [],
      why: "the config keys (`secretKey`, `processingChannelId`, `baseUrl`, the webhook keys, `accounts`), `antelopeJs.implements` and the interface range",
    },
    outbound: {
      globs: ["src/implementations/payment/http.ts"],
      funnels: ["src/implementations/payment/http.ts"],
      why: "every payment, refund and customer call leaves through this one client to Checkout.com with the merchant's secret key: its URL, headers and idempotency key decide whose money moves",
    },
    exposure: {
      globs: ["src/implementations/payment/signature.ts"],
      funnels: ["src/implementations/payment/signature.ts"],
      why: "the signature check is what makes a webhook delivery trusted: a consumer's route forwards the raw request here before it acts on a payment event",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      why: "the package name and release workflow claim @antelopejs/checkout-com on npm",
    },
  },
  formal: [
    {
      name: "formal-webhook-acceptance",
      covers: ["src/implementations/payment/signature.ts"],
      files: [".agents/skills/formal-webhook-acceptance/**"],
      command: ["node", ".agents/skills/formal-webhook-acceptance/check.ts"],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)(?: \((?<states>\d+) states\))?/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
    {
      name: "formal-saved-method-chain",
      covers: [
        "src/implementations/payment/saved-methods.ts",
        "src/implementations/payment/follow.ts",
        "src/implementations/payment/payments.ts",
        "src/implementations/payment/customers.ts",
        "src/implementations/payment/mapping.ts",
      ],
      files: [".agents/skills/formal-saved-method-chain/**"],
      command: ["node", ".agents/skills/formal-saved-method-chain/check.mts"],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)(?: \((?<states>\d+) states)?/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
  ],
  moduleConfig() {
    return {
      secretKey: "sk_sbox_verify0000000000000000000",
      processingChannelId: "pc_verify0000000000000000000",
      baseUrl: "http://127.0.0.1:9",
      webhookSignatureKey: "verify-signature-key",
      checkoutBillingCountry: "FR",
    };
  },
  journeys: {
    ...paymentJourneys,
    ...holdJourneys,
    ...refundJourneys,
    ...customerJourneys,
    ...checkoutJourneys,
    ...webhookJourneys,
    ...accountJourneys,
    ...sandboxJourneys,
  },
};

export default config;
