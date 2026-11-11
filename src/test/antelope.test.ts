import { MongoMemoryServer } from "mongodb-memory-server-core";
import {
  type AntelopeConfig,
  defineConfig,
} from "@antelopejs/interface-core/config";

import { type Config, DefaultBaseUrl } from "../config";
import { MintInstrument, type Target } from "./mint";
import { REFUNDS_BLOCKED_REASON, RefundsBlocked } from "./balance";
import { type LiveEnvironment, ResolveEnvironment } from "./environment";
import {
  RegisterStandIn,
  STAND_IN_PROCESSING_CHANNEL,
  STAND_IN_PUBLIC_KEY,
  STAND_IN_SECRET_KEY,
  StandIn,
} from "./standin";
import {
  SECONDARY_WEBHOOK_AUTHORIZATION,
  SECONDARY_WEBHOOK_KEY,
  TEST_BILLING_COUNTRY,
  TEST_CARDS,
  TEST_WEBHOOK_KEY,
} from "./constants";

const MONGO_VERSION = "8.0.8";
const TEST_POLL_MS = 100;

let standIn: StandIn | undefined;
let mongod: MongoMemoryServer | undefined;

function liveTarget(environment: LiveEnvironment): Target {
  const target: Target = {
    baseUrl: environment.baseUrl ?? DefaultBaseUrl(environment.secretKey),
    secretKey: environment.secretKey,
    processingChannelId: environment.processingChannelId,
  };
  if (process.env.CKO_PUBLIC_KEY) target.publicKey = process.env.CKO_PUBLIC_KEY;
  return target;
}

async function standInTarget(): Promise<Target> {
  standIn = new StandIn();
  const baseUrl = await standIn.start();
  RegisterStandIn(standIn);
  return {
    baseUrl,
    secretKey: STAND_IN_SECRET_KEY,
    publicKey: STAND_IN_PUBLIC_KEY,
    processingChannelId: STAND_IN_PROCESSING_CHANNEL,
  };
}

/**
 * The conformance suite's charge tests need reusable methods, which only
 * exist once a card has been tokenized with the public key. Without one the
 * suite skips them, exactly as it does for any provider with no test method.
 */
async function mintTestMethods(target: Target): Promise<void> {
  if (!target.publicKey) return;
  process.env.ANTELOPE_PAYMENT_TEST_METHOD = await MintInstrument(
    target,
    TEST_CARDS.approved,
  );
  process.env.ANTELOPE_PAYMENT_TEST_METHOD_DECLINED = await MintInstrument(
    target,
    TEST_CARDS.insufficientFunds,
  );
}

/**
 * A sandbox account without balance accepts every refund with a 202 and fails
 * it with 50003, so the refund tests could only fail. One probe decides it
 * per live run: blocked, they skip with the reason; otherwise, a probe that
 * could not tell included, they run.
 */
async function probeRefunds(target: Target): Promise<void> {
  const method = process.env.ANTELOPE_PAYMENT_TEST_METHOD;
  if (!method) return;
  const isBlocked = await RefundsBlocked(target, method).catch(() => false);
  if (!isBlocked) return;
  process.env.CKO_TEST_REFUNDS_BLOCKED = REFUNDS_BLOCKED_REASON;
}

function accountConfig(target: Target): Config {
  const account = {
    secretKey: target.secretKey,
    processingChannelId: target.processingChannelId,
    baseUrl: target.baseUrl,
  };
  return {
    ...account,
    webhookSignatureKey: TEST_WEBHOOK_KEY,
    checkoutBillingCountry: TEST_BILLING_COUNTRY,
    accounts: {
      secondary: {
        ...account,
        webhookSignatureKey: SECONDARY_WEBHOOK_KEY,
        webhookAuthorization: SECONDARY_WEBHOOK_AUTHORIZATION,
        merchantInitiatedType: "Unscheduled",
      },
    },
  };
}

function exposeTarget(target: Target, mode: string): void {
  Object.assign(process.env, {
    ANTELOPE_PAYMENT_TEST_CURRENCY: "EUR",
    CKO_TEST_MODE: mode,
    CKO_TEST_BASE_URL: target.baseUrl,
    CKO_TEST_SECRET_KEY: target.secretKey,
    CKO_TEST_PUBLIC_KEY: target.publicKey ?? "",
    CKO_TEST_PROCESSING_CHANNEL_ID: target.processingChannelId,
  });
}

function fallbackModules(
  mongoUrl: string,
): NonNullable<AntelopeConfig["modules"]> {
  return {
    mongodb: {
      source: { type: "local", path: "node_modules/@antelopejs/mongodb" },
      config: { url: mongoUrl, database: "checkout_com_test" },
    },
    subscriptions: {
      source: {
        type: "local",
        path: "node_modules/@antelopejs/payment-subscriptions",
      },
      config: { pollIntervalMs: TEST_POLL_MS, sweepIntervalMs: TEST_POLL_MS },
    },
    probe: { source: { type: "local", path: "test/renewal-probe" } },
  };
}

export default defineConfig({
  name: "checkout-com-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: { source: { type: "local", path: "." } },
  },
  test: {
    folder: "dist/test",
    async setup() {
      const environment = ResolveEnvironment(process.env);
      const target =
        environment.mode === "live"
          ? liveTarget(environment)
          : await standInTarget();
      exposeTarget(target, environment.mode);
      await mintTestMethods(target);
      if (environment.mode === "live") await probeRefunds(target);
      mongod = await MongoMemoryServer.create({
        binary: { version: MONGO_VERSION },
      });
      return {
        modules: {
          local: { config: accountConfig(target) },
          ...fallbackModules(mongod.getUri()),
        },
      };
    },
    async cleanup() {
      await standIn?.stop();
      await mongod?.stop();
    },
  },
});
