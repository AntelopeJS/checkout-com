import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, SECONDARY_AUTHORIZATION, SECONDARY_WEBHOOK_KEY, answered, call, delivery, pay, pick, same, thrown, withSession, text } from "./session.ts";

const webhookSignature: Journey = {
  title: "a delivery is accepted only when its Cko-Signature is the HMAC-SHA256 of the raw body under the account's key, and an account that was given an Authorization value also needs it back",
  entryPoint: "`VerifyWebhook` through core with deliveries signed the way Checkout.com's workflow signs them",
  async run(context) {
    await withSession(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      await session.standIn.settled();
      const signed = delivery("payment_captured", { id, action_id: "act_verify" });
      const accepted = await call(session, "VerifyWebhook of a genuine delivery", "VerifyWebhook", [signed, null]);
      context.expect(accepted.folder, [
        answered(accepted),
        same("the delivery becomes a payment.succeeded event for the payment", [pick(accepted.value, "type"), pick(accepted.value, "payment", "id")], ["payment.succeeded", id]),
      ], { critical: true });
      const tampered = await call(session, "VerifyWebhook of an altered body", "VerifyWebhook", [{ ...signed, body: signed.body.replace("act_verify", "act_other") }, null]);
      context.expect(tampered.folder, [
        same("a body that differs from the signed one is refused", pick(thrown(tampered), 0), "WebhookVerificationError"),
        same("the refusal says the signature does not match", text(pick(thrown(tampered), 1)).includes("does not match the body"), true),
      ]);
      const unsigned = await call(session, "VerifyWebhook without a signature", "VerifyWebhook", [{ body: signed.body, headers: {} }, null]);
      context.expect(unsigned.folder, [same("a delivery with no signature is refused", pick(thrown(unsigned), 0), "WebhookVerificationError")]);
      const garbled = await call(session, "VerifyWebhook with a non-hex signature", "VerifyWebhook", [{ body: signed.body, headers: { "cko-signature": "not-a-digest" } }, null]);
      context.expect(garbled.folder, [same("a signature that is not a SHA-256 digest is refused", text(pick(thrown(garbled), 1)).includes("hex"), true)]);
      const foreign = delivery("payment_captured", { id, action_id: "act_verify" }, SECONDARY_WEBHOOK_KEY);
      const wrongKey = await call(session, "VerifyWebhook signed under another account's key", "VerifyWebhook", [foreign, null]);
      context.expect(wrongKey.folder, [same("a delivery signed under another key is refused", pick(thrown(wrongKey), 0), "WebhookVerificationError")]);
      const secondary = await call(session, "VerifyWebhook on the secondary account without its authorization", "VerifyWebhook", [foreign, "secondary"]);
      context.expect(secondary.folder, [
        same("the secondary account needs its Authorization header back", pick(thrown(secondary), 0), "WebhookVerificationError"),
        same("the refusal names the Authorization header", text(pick(thrown(secondary), 1)).includes("Authorization"), true),
      ]);
      const authorized = await call(session, "VerifyWebhook on the secondary account with its authorization", "VerifyWebhook", [{ ...foreign, headers: { ...foreign.headers, authorization: SECONDARY_AUTHORIZATION } }, "secondary"]);
      context.expect(authorized.folder, [answered(authorized), same("with both, the secondary account accepts it", pick(authorized.value, "type"), "payment.succeeded")]);
    });
  },
};

const webhookEvents: Journey = {
  title: "genuine deliveries become the interface's events: a refund settles as refund.succeeded, a decline as payment.failed, and an event type the module does not map is ignored",
  entryPoint: "`VerifyWebhook` through core with signed `payment_refunded`, `payment_declined` and unmapped deliveries",
  async run(context) {
    await withSession(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      await session.standIn.settled();
      const refunded = await call(session, "VerifyWebhook of payment_refunded", "VerifyWebhook", [delivery("payment_refunded", { id, action_id: "act_refund", amount: 1000, currency: "EUR" }), null]);
      context.expect(refunded.folder, [
        answered(refunded),
        same("a refunded delivery is refund.succeeded with the refund's amount and payment", [pick(refunded.value, "type"), pick(refunded.value, "refund", "amount", "value"), pick(refunded.value, "refund", "payment")], ["refund.succeeded", 1000, id]),
      ]);
      const declined = await pay(session, "CreatePayment declined", CARDS.insufficientFunds);
      const failed = await call(session, "VerifyWebhook of payment_declined", "VerifyWebhook", [delivery("payment_declined", { id: text(pick(declined.value, "id")) }), null]);
      context.expect(failed.folder, [
        answered(failed),
        same("a declined delivery is payment.failed for a payment read back as failed", [pick(failed.value, "type"), pick(failed.value, "payment", "status")], ["payment.failed", "failed"]),
      ]);
      const unmapped = await call(session, "VerifyWebhook of an unmapped event", "VerifyWebhook", [delivery("payment_something_new", { id }), null]);
      context.expect(unmapped.folder, [answered(unmapped), same("an event type the module does not map yields no event", unmapped.value, null)]);
    });
  },
};

export const webhookJourneys = { "webhook-signature": webhookSignature, "webhook-events": webhookEvents };
