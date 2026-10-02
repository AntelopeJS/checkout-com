import assert from "node:assert/strict";

import { ResolveEnvironment } from "./environment";
import { DefaultBaseUrl, ToAccount } from "../config";

const SANDBOX_KEY = `sk_sbox_${"a".repeat(26)}`;
const PRODUCTION_KEY = `sk_${"a".repeat(26)}`;
const CHANNEL = `pc_${"b".repeat(26)}`;
const MERCHANT_URL = "https://vkuhvk4v.api.sandbox.checkout.com";

describe("[checkout-com] choosing between the sandbox and the stand-in", () => {
  it("runs against the stand-in when no key is set", () => {
    assert.deepEqual(ResolveEnvironment({}), { mode: "stand-in" });
    assert.deepEqual(
      ResolveEnvironment({ CKO_SECRET_KEY: "", CKO_PROCESSING_CHANNEL_ID: "" }),
      { mode: "stand-in" },
    );
  });

  it("runs live when a sandbox key and a processing channel are both set", () => {
    assert.deepEqual(
      ResolveEnvironment({
        CKO_SECRET_KEY: SANDBOX_KEY,
        CKO_PROCESSING_CHANNEL_ID: CHANNEL,
      }),
      { mode: "live", secretKey: SANDBOX_KEY, processingChannelId: CHANNEL },
    );
  });

  it("carries the merchant-specific base URL when one is given", () => {
    const environment = ResolveEnvironment({
      CKO_SECRET_KEY: SANDBOX_KEY,
      CKO_PROCESSING_CHANNEL_ID: CHANNEL,
      CKO_BASE_URL: MERCHANT_URL,
    });
    assert.equal(environment.mode, "live");
    assert.equal(
      environment.mode === "live" && environment.baseUrl,
      MERCHANT_URL,
    );
  });

  it("refuses half a configuration rather than quietly testing the stand-in", () => {
    assert.throws(
      () => ResolveEnvironment({ CKO_SECRET_KEY: SANDBOX_KEY }),
      /both CKO_SECRET_KEY and CKO_PROCESSING_CHANNEL_ID/,
    );
    assert.throws(
      () => ResolveEnvironment({ CKO_PROCESSING_CHANNEL_ID: CHANNEL }),
      /both CKO_SECRET_KEY and CKO_PROCESSING_CHANNEL_ID/,
    );
  });

  it("refuses a production key", () => {
    assert.throws(
      () =>
        ResolveEnvironment({
          CKO_SECRET_KEY: PRODUCTION_KEY,
          CKO_PROCESSING_CHANNEL_ID: CHANNEL,
        }),
      /not a sandbox key/,
    );
  });

  it("refuses something that is not a processing channel", () => {
    assert.throws(
      () =>
        ResolveEnvironment({
          CKO_SECRET_KEY: SANDBOX_KEY,
          CKO_PROCESSING_CHANNEL_ID: "channel-1",
        }),
      /not a processing channel id/,
    );
  });
});

describe("[checkout-com] where an account sends its calls", () => {
  it("defaults to the shared host of the key's environment", () => {
    assert.equal(
      DefaultBaseUrl(SANDBOX_KEY),
      "https://api.sandbox.checkout.com",
    );
    assert.equal(DefaultBaseUrl(PRODUCTION_KEY), "https://api.checkout.com");
  });

  it("prefers the configured merchant-specific base URL", () => {
    const account = ToAccount(
      {
        secretKey: SANDBOX_KEY,
        processingChannelId: CHANNEL,
        baseUrl: MERCHANT_URL,
      },
      {} as never,
    );
    assert.equal(account.client.baseUrl, MERCHANT_URL);
  });

  it("declares saved-method charges as Recurring unless told otherwise", () => {
    const account = ToAccount(
      { secretKey: SANDBOX_KEY, processingChannelId: CHANNEL },
      {} as never,
    );
    assert.equal(account.merchantInitiatedType, "Recurring");
    assert.equal(account.client.baseUrl, "https://api.sandbox.checkout.com");
  });
});
