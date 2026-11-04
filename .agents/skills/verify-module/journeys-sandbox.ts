import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, answered, callsTo, pay, same, withSession } from "./session.ts";

const requestContract: Journey = {
  title: "a request to Checkout.com is a JSON POST under the secret key as a bearer token, to the configured base URL",
  entryPoint: "`CreatePayment` through core against the stand-in",
  async run(context) {
    await withSession(context, async (session) => {
      const created = await pay(session, "CreatePayment", CARDS.approved);
      context.expect(created.folder, [
        answered(created),
        same("the stand-in, which refuses any other key, answered the payment request with a success", (callsTo(session.standIn, "POST", "/payments")[0]?.status ?? 0) < 300, true),
      ]);
    });
  },
};

const sandboxLive: Journey = {
  title: "the module against Checkout.com's own sandbox",
  entryPoint: "`CreatePayment` against the merchant's sandbox base URL with a sandbox key",
  run(context) {
    return Promise.resolve(
      context.notVerified("no journey reaches Checkout.com's sandbox: it needs the merchant's sk_sbox_ key, processing channel and base URL, which only the operator holds; the module's own `pnpm test` runs live with CKO_SECRET_KEY and CKO_PROCESSING_CHANNEL_ID"),
    );
  },
};

export const sandboxJourneys = { "request-contract": requestContract, "sandbox-live": sandboxLive };
