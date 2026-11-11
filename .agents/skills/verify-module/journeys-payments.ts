import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, answered, call, callsTo, challenged, fresh, mintToken, onSandboxAndStandIn, onStandIn, pay, pick, same, sent, settled, statusIs, text, thrown } from "./session.ts";

const payApproved: Journey = {
  title: "a card token becomes one payment at Checkout.com with the amount, reference and processing channel, reads back as succeeded once captured, and the provider holds it as captured",
  entryPoint: "`CreatePayment` and `GetPayment` through core against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const reference = fresh("order");
      const key = fresh("key");
      const created = await pay(session, "CreatePayment", CARDS.approved, { request: { reference }, key });
      context.expect(created.folder, [
        answered(created),
        same("the amount and the reference are the request's", [pick(created.value, "amount"), pick(created.value, "reference")], [EUR, reference]),
        same("a payment that will be captured by itself reads pending, not authorized", pick(created.value, "status"), "pending"),
      ], { critical: true });
      const id = text(pick(created.value, "id"));
      const held = await settled(session, id, statusIs("Captured"));
      context.expect(created.folder, [
        ...(await sent(session, ({ standIn, keys }) => {
          const posted = callsTo(standIn, "POST", "/payments");
          return [
            same("Checkout.com received one payment request", posted.length, 1),
            same("it carries the amount in minor units, the currency, the reference and the processing channel", [pick(posted[0]?.body, "amount"), pick(posted[0]?.body, "currency"), pick(posted[0]?.body, "reference"), pick(posted[0]?.body, "processing_channel_id")], [2500, "EUR", reference, keys.processingChannel]),
            same("it carries the caller's idempotency key", posted[0]?.idempotencyKey ?? null, key),
            same("it paid with a token source", pick(posted[0]?.body, "source", "type"), "token"),
            same("Checkout.com accepted it", (posted[0]?.status ?? 0) < 300, true),
          ];
        })),
        same("Checkout.com itself holds it captured for 2500 EUR under the reference, as a Regular payment", [pick(held, "status"), pick(held, "amount"), pick(held, "currency"), pick(held, "reference"), pick(held, "payment_type")], ["Captured", 2500, "EUR", reference, "Regular"]),
      ]);
      const read = await call(session, "GetPayment", "GetPayment", [id]);
      context.expect(read.folder, [
        answered(read),
        same("the captured payment reads succeeded with the amount captured", [pick(read.value, "status"), pick(read.value, "amountCaptured")], ["succeeded", EUR]),
      ]);
    });
  },
};

const payDeclined: Journey = {
  title: "a card the issuer declines is a failed payment carrying the response code and its reason, not a thrown error",
  entryPoint: "`CreatePayment` with the insufficient-funds test card, then `GetPayment`, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const declined = await pay(session, "CreatePayment declined", CARDS.insufficientFunds);
      context.expect(declined.folder, [
        answered(declined),
        same("the payment is failed", pick(declined.value, "status"), "failed"),
        same("the failure carries the insufficient-funds code and Checkout.com's response code", [pick(declined.value, "failure", "code"), pick(declined.value, "failure", "providerCode")], ["insufficient_funds", "20051"]),
      ], { critical: true });
      const read = await call(session, "GetPayment of the declined payment", "GetPayment", [text(pick(declined.value, "id"))]);
      context.expect(read.folder, [
        same("reading it later still says failed with the same reason", [pick(read.value, "status"), pick(read.value, "failure", "code")], ["failed", "insufficient_funds"]),
      ]);
      const unknown = await call(session, "GetPayment of an unknown id", "GetPayment", ["pay_00000000000000000000000000"]);
      context.expect(unknown.folder, [same("an unknown payment is a PaymentNotFoundError", pick(thrown(unknown), 0), "PaymentNotFoundError")]);
      const malformed = await call(session, "GetPayment of an id that cannot be Checkout.com's", "GetPayment", ["not-a-payment"]);
      context.expect(malformed.folder, [
        same("an id that cannot exist is not found", pick(thrown(malformed), 0), "PaymentNotFoundError"),
        ...(await sent(session, ({ standIn }) => [same("no GET /payments call went out for it", callsTo(standIn, "GET", "/payments/not-a-payment").length, 0)])),
      ]);
    });
  },
};

const payIdempotent: Journey = {
  title: "replaying a payment with the same idempotency key returns the same payment and charges once, a duplicate sent while the first is in flight is either that payment or a retryable refusal, and a new key is a new payment",
  entryPoint: "`CreatePayment` twice with one idempotency key, then twice at once with another and once more to retry it, then once with a third, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const key = fresh("key");
      const token = await mintToken(session, CARDS.approved);
      const request = { amount: EUR, reference: fresh("order"), paymentMethod: token };
      const first = await call(session, "CreatePayment", "CreatePayment", [request, key, null]);
      const replay = await call(session, "CreatePayment replayed", "CreatePayment", [request, key, null]);
      context.expect(replay.folder, [
        answered(first),
        answered(replay),
        same("the replay returns the first payment", pick(replay.value, "id"), pick(first.value, "id")),
        ...(await sent(session, ({ standIn }) => [same("Checkout.com answered the second request from its idempotency cache", callsTo(standIn, "POST", "/payments").map((entry) => entry.replayed), [false, true])])),
      ]);
      const concurrentKey = fresh("key");
      const concurrentRequest = { ...request, reference: fresh("order"), paymentMethod: await mintToken(session, CARDS.approved) };
      const [left, right] = await Promise.all([
        call(session, "CreatePayment under a fresh key", "CreatePayment", [concurrentRequest, concurrentKey, null]),
        call(session, "CreatePayment under the same key at the same time", "CreatePayment", [concurrentRequest, concurrentKey, null]),
      ]);
      const retried = await call(session, "CreatePayment retried under that key", "CreatePayment", [concurrentRequest, concurrentKey, null]);
      const paid = [left, right].filter((result) => pick(result.value, "id") !== undefined);
      const refused = [left, right].filter((result) => pick(result.value, "id") === undefined);
      context.expect(retried.folder, [
        answered(left),
        answered(right),
        same("every concurrent call that returned a payment returned the one the retry returns", paid.map((result) => text(pick(result.value, "id"))), paid.map(() => text(pick(retried.value, "id")))),
        same("a refused duplicate is a retryable PaymentError naming duplicate_request", refused.map((result) => [text(pick(thrown(result), 0)), text(pick(thrown(result), 1)).includes("duplicate_request")]), refused.map(() => ["PaymentError", true])),
        ...(await sent(session, ({ standIn }) => [same("Checkout.com created one payment for the key", callsTo(standIn, "POST", "/payments").filter((entry) => entry.idempotencyKey === concurrentKey && !entry.replayed && entry.status < 300).length, 1)])),
      ]);
      const other = await call(session, "CreatePayment under a new key", "CreatePayment", [{ ...request, paymentMethod: await mintToken(session, CARDS.approved) }, fresh("key"), null]);
      context.expect(other.folder, [answered(other), same("a new key makes a new payment", pick(other.value, "id") === pick(first.value, "id"), false)]);
    });
  },
};

const pay3ds: Journey = {
  title: "a payment that needs 3-D Secure comes back as requires_action with the payer's redirect, keeps both on reads while the payer is away, and ends by the payer's outcome",
  entryPoint: "`CreatePayment` with the 3-D Secure challenge test card, the payer completing or failing the challenge at the stand-in, then `GetPayment`; stand-in only, since a challenge needs a password typed in the sandbox's iframe",
  async run(context) {
    await onStandIn(context, async (session) => {
      const { standIn } = session.target;
      const challenge = await challenged(session, "CreatePayment challenged");
      context.expect(challenge.folder, [
        answered(challenge),
        same("the payment needs action and carries the redirect", [pick(challenge.value, "status"), text(pick(challenge.value, "redirectUrl")).startsWith("http")], ["requires_action", true]),
      ], { critical: true });
      const id = text(pick(challenge.value, "id"));
      const posted = callsTo(standIn, "POST", "/payments")[0];
      context.expect(challenge.folder, [
        same("the return URL became both the success and failure URL", [pick(posted?.body, "success_url"), pick(posted?.body, "failure_url")], ["https://merchant.invalid/return", "https://merchant.invalid/return"]),
      ]);
      const waiting = await call(session, "GetPayment while the payer is away", "GetPayment", [id]);
      context.expect(waiting.folder, [same("the waiting payment still reads requires_action with the same redirect", [pick(waiting.value, "status"), pick(waiting.value, "redirectUrl") ?? null], ["requires_action", pick(challenge.value, "redirectUrl") ?? null])]);
      standIn.completeChallenge(id, true);
      await standIn.settled();
      const done = await call(session, "GetPayment after the payer authenticated", "GetPayment", [id]);
      context.expect(done.folder, [same("the payer's success makes it succeeded", pick(done.value, "status"), "succeeded")]);
      const abandoned = await challenged(session, "CreatePayment challenged again");
      const failedId = text(pick(abandoned.value, "id"));
      standIn.completeChallenge(failedId, false);
      await standIn.settled();
      const failed = await call(session, "GetPayment after the payer failed authentication", "GetPayment", [failedId]);
      context.expect(failed.folder, [same("the payer's failure makes it failed with the authentication reason", [pick(failed.value, "status"), pick(failed.value, "failure", "code"), pick(failed.value, "failure", "providerCode")], ["failed", "authentication_failed", "20151"])]);
    });
  },
};

export const paymentJourneys = { "pay-approved": payApproved, "pay-declined": payDeclined, "pay-idempotent": payIdempotent, "pay-3ds": pay3ds };
