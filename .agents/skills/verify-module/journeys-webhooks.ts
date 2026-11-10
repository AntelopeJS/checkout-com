import type { Journey } from "@antelopejs/tooling-configs/verify";

import { recordOf } from "./json.ts";
import { CARDS, SECONDARY_AUTHORIZATION, SECONDARY_WEBHOOK_KEY, answered, call, delivery, onSandboxAndStandIn, pay, paymentAtProvider, pick, same, settled, statusIs, thrown, text } from "./session.ts";

const webhookSignature: Journey = {
  title: "a delivery is accepted only when its Cko-Signature is the HMAC-SHA256 of the raw body under the account's key, and an account that was given an Authorization value also needs it back",
  entryPoint: "`VerifyWebhook` through core with deliveries signed the way Checkout.com's workflow signs them, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      await settled(session, id, statusIs("Captured"));
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
      const digest = signed.headers["cko-signature"] ?? "";
      const accepting: [string, string][] = [
        ["a digest in upper-case hex", digest.toUpperCase()],
        ["a digest with surrounding whitespace", `  ${digest}\t`],
      ];
      for (const [name, signature] of accepting) {
        const read = await call(session, `VerifyWebhook with ${name}`, "VerifyWebhook", [{ ...signed, headers: { ...signed.headers, "cko-signature": signature } }, null]);
        context.expect(read.folder, [answered(read), same(`${name} is accepted as the same signature`, [pick(read.value, "type"), pick(read.value, "payment", "id")], ["payment.succeeded", id])]);
      }
      const wrongLength: [string, string][] = [
        ["a 62-hex-digit digest", digest.slice(0, 62)],
        ["a 66-hex-digit digest", `${digest}ab`],
      ];
      for (const [name, signature] of wrongLength) {
        const refused = await call(session, `VerifyWebhook with ${name}`, "VerifyWebhook", [{ ...signed, headers: { ...signed.headers, "cko-signature": signature } }, null]);
        context.expect(refused.folder, [
          same(`${name} is refused as a WebhookVerificationError`, pick(thrown(refused), 0), "WebhookVerificationError"),
          same(`${name} is refused for not being a SHA-256 hex digest`, text(pick(thrown(refused), 1)).includes("hex"), true),
        ]);
      }
      const nearMisses: [string, string][] = [
        ["a wrong value", "verify-secondary-wrong"],
        ["a prefix of the right value", SECONDARY_AUTHORIZATION.slice(0, -1)],
        ["the right value with a trailing space", `${SECONDARY_AUTHORIZATION} `],
      ];
      for (const [name, value] of nearMisses) {
        const refused = await call(session, `VerifyWebhook on the secondary account with ${name}`, "VerifyWebhook", [{ ...foreign, headers: { ...foreign.headers, authorization: value } }, "secondary"]);
        context.expect(refused.folder, [
          same(`the secondary account refuses ${name} as its Authorization header`, pick(thrown(refused), 0), "WebhookVerificationError"),
          same("the refusal is about the Authorization header, not the signature", text(pick(thrown(refused), 1)).includes("Authorization"), true),
        ]);
      }
    });
  },
};

const webhookEvents: Journey = {
  title: "genuine deliveries become the interface's events: a refund settles as refund.succeeded, a decline as payment.failed, and an event type the module does not map is ignored",
  entryPoint: "`VerifyWebhook` through core with signed `payment_refunded`, `payment_declined`, `payment_approved` and unmapped deliveries, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      await settled(session, id, statusIs("Captured"));
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
      const automaticId = text(pick(paid.value, "id"));
      const automatic = await call(session, "VerifyWebhook of payment_approved for an automatic capture", "VerifyWebhook", [
        delivery("payment_approved", { id: automaticId, metadata: recordOf(pick(await paymentAtProvider(session, automaticId), "metadata")) }),
        null,
      ]);
      context.expect(automatic.folder, [answered(automatic), same("an approval of a payment Checkout.com captures by itself yields no event: the capture's own event follows", automatic.value, null)]);
      const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
      const heldId = text(pick(held.value, "id"));
      const authorized = await call(session, "VerifyWebhook of payment_approved for an authorizeOnly payment", "VerifyWebhook", [
        delivery("payment_approved", { id: heldId, metadata: recordOf(pick(await paymentAtProvider(session, heldId), "metadata")) }),
        null,
      ]);
      context.expect(authorized.folder, [
        answered(authorized),
        same("an approval of an authorizeOnly payment is payment.authorized with the payment read back", [pick(authorized.value, "type"), pick(authorized.value, "payment", "id"), pick(authorized.value, "payment", "status")], ["payment.authorized", heldId, "authorized"]),
      ]);
    });
  },
};

export const webhookJourneys = { "webhook-signature": webhookSignature, "webhook-events": webhookEvents };
