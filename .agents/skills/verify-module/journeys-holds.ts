import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, answered, challenged, call, callsTo, fresh, onSandboxAndStandIn, pay, paymentAtProvider, pick, same, sent, settled, statusIs, thrown, text, type Json } from "./session.ts";

const HALF = { value: 1000, currency: "EUR" };

function captured(held: Json): Json | undefined {
  return pick(held, "balances", "total_captured");
}

const holdCapture: Journey = {
  title: "an authorize-only payment is a hold that a capture, in full or in part, settles, and a payment captured by itself refuses a capture",
  entryPoint: "`CreatePayment` with `authorizeOnly`, `CapturePayment` and `GetPayment` through core, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
      context.expect(held.folder, [
        answered(held),
        same("the hold reads authorized with nothing captured", [pick(held.value, "status"), pick(held.value, "amountCaptured", "value")], ["authorized", 0]),
        ...(await sent(session, ({ standIn }) => [same("Checkout.com was asked not to capture", pick(callsTo(standIn, "POST", "/payments")[0]?.body, "capture"), false)])),
      ], { critical: true });
      const id = text(pick(held.value, "id"));
      const key = fresh("key");
      const partial = await call(session, "CapturePayment in part", "CapturePayment", [id, key, HALF, null]);
      context.expect(partial.folder, [
        answered(partial),
        same("the returned payment shows the capture applied", pick(partial.value, "amountCaptured", "value"), 1000),
      ]);
      const provider = await settled(session, id, (value) => captured(value) === 1000);
      context.expect(partial.folder, [
        ...(await sent(session, ({ standIn }) => {
          const asked = callsTo(standIn, "POST", `/payments/${id}/captures`)[0];
          return [same("Checkout.com received a capture of 1000 under the caller's key", [pick(asked?.body, "amount"), asked?.idempotencyKey ?? null], [1000, key])];
        })),
        same("Checkout.com holds 1000 of the 2500 captured: the hold was not captured by itself", [captured(provider), pick(provider, "balances", "total_authorized")], [1000, 2500]),
      ]);
      const read = await call(session, "GetPayment after the capture", "GetPayment", [id]);
      context.expect(read.folder, [same("the payment is succeeded with 1000 captured", [pick(read.value, "status"), pick(read.value, "amountCaptured", "value")], ["succeeded", 1000])]);
      const automatic = await pay(session, "CreatePayment captured by itself", CARDS.approved);
      const automaticId = text(pick(automatic.value, "id"));
      const refused = await call(session, "CapturePayment on an automatic payment", "CapturePayment", [automaticId, fresh("key"), null, null]);
      context.expect(refused.folder, [
        same("capturing a payment Checkout.com captures by itself is refused as a state error", pick(thrown(refused), 0), "InvalidPaymentStateError"),
        ...(await sent(session, ({ standIn }) => [same("no capture request went out for it", callsTo(standIn, "POST", `/payments/${automaticId}/captures`).length, 0)])),
      ]);
    });
  },
};

const holdCancel: Journey = {
  title: "an authorized hold can be cancelled, which Checkout.com voids, and a payment waiting for 3-D Secure cannot",
  entryPoint: "`CancelPayment` through core, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
      const id = text(pick(held.value, "id"));
      const voided = await call(session, "CancelPayment", "CancelPayment", [id, fresh("key"), null]);
      context.expect(voided.folder, [
        answered(voided),
        same("the payment reads canceled", pick(voided.value, "status"), "canceled"),
        ...(await sent(session, ({ standIn }) => [same("Checkout.com received one void", callsTo(standIn, "POST", `/payments/${id}/voids`).length, 1)])),
      ]);
      const provider = await settled(session, id, statusIs("Voided"));
      context.expect(voided.folder, [same("Checkout.com itself holds it as voided, with the whole amount voided", [pick(provider, "status"), pick(provider, "balances", "total_voided")], ["Voided", EUR.value])]);
      const waiting = await challenged(session, "CreatePayment challenged");
      const waitingId = text(pick(waiting.value, "id"));
      context.expect(waiting.folder, [answered(waiting), same("the payment waits for the payer's 3-D Secure", pick(waiting.value, "status"), "requires_action")], { critical: true });
      const refused = await call(session, "CancelPayment of a payment waiting for 3-D Secure", "CancelPayment", [waitingId, fresh("key"), null]);
      context.expect(refused.folder, [
        same("cancelling a payment with no authorization yet is a state error", pick(thrown(refused), 0), "InvalidPaymentStateError"),
        ...(await sent(
          session,
          ({ standIn }) => [same("the module asked Checkout.com for the void, which refused it with 422 as the sandbox does", callsTo(standIn, "POST", `/payments/${waitingId}/voids`).map((entry) => entry.status), [422])],
          async () => [same("Checkout.com still holds the payment unvoided, waiting for 3-D Secure", pick(await paymentAtProvider(session, waitingId), "status"), "Pending")],
        )),
      ]);
    });
  },
};

const holdSettleBudget: Journey = {
  title: "with settleTimeoutMs at 0 a capture returns the payment as Checkout.com last reported it, still authorized, and a later read shows the capture applied",
  entryPoint: "`CapturePayment` of an `authorizeOnly` hold on an account with `settleTimeoutMs: 0`, then `GetPayment` once Checkout.com has applied the capture, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(
      context,
      async (session) => {
        const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
        const id = text(pick(held.value, "id"));
        context.expect(held.folder, [answered(held), same("the hold reads authorized", pick(held.value, "status"), "authorized")], { critical: true });
        const capture = await call(session, "CapturePayment with no settle budget", "CapturePayment", [id, fresh("key"), null, null]);
        context.expect(capture.folder, [
          answered(capture),
          same("the call returned the payment as last reported: authorized, nothing captured yet", [pick(capture.value, "status"), pick(capture.value, "amountCaptured", "value")], ["authorized", 0]),
        ]);
        const provider = await settled(session, id, statusIs("Captured"));
        context.expect(capture.folder, [
          ...(await sent(session, ({ standIn }) => [same("Checkout.com was asked for one capture", callsTo(standIn, "POST", `/payments/${id}/captures`).length, 1)])),
          same("Checkout.com applied the one capture, of the whole amount", [pick(provider, "status"), captured(provider)], ["Captured", EUR.value]),
        ]);
        const read = await call(session, "GetPayment after the capture settled", "GetPayment", [id]);
        context.expect(read.folder, [same("a later read shows the capture applied: succeeded with the whole amount captured", [pick(read.value, "status"), pick(read.value, "amountCaptured", "value")], ["succeeded", EUR.value])]);
      },
      { settleTimeoutMs: 0 },
    );
  },
};

export const holdJourneys = { "hold-capture": holdCapture, "hold-cancel": holdCancel, "hold-settle-budget": holdSettleBudget };
