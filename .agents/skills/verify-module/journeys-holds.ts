import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, answered, challenged, call, callsTo, fresh, pay, paymentAtProvider, pick, same, thrown, withSession, text } from "./session.ts";

const HALF = { value: 1000, currency: "EUR" };

const holdCapture: Journey = {
  title: "an authorize-only payment is a hold that a capture, in full or in part, settles, and a payment captured by itself refuses a capture",
  entryPoint: "`CreatePayment` with `authorizeOnly`, `CapturePayment` and `GetPayment` through core",
  async run(context) {
    await withSession(context, async (session) => {
      const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
      context.expect(held.folder, [
        answered(held),
        same("the hold reads authorized with nothing captured", [pick(held.value, "status"), pick(held.value, "amountCaptured", "value")], ["authorized", 0]),
        same("Checkout.com was asked not to capture", pick(callsTo(session.standIn, "POST", "/payments")[0]?.body, "capture"), false),
      ], { critical: true });
      const id = text(pick(held.value, "id"));
      const key = fresh("key");
      const captured = await call(session, "CapturePayment in part", "CapturePayment", [id, key, HALF, null]);
      context.expect(captured.folder, [
        answered(captured),
        same("Checkout.com received a capture of 1000 under the caller's key", [pick(callsTo(session.standIn, "POST", `/payments/${id}/captures`)[0]?.body, "amount"), callsTo(session.standIn, "POST", `/payments/${id}/captures`)[0]?.idempotencyKey ?? null], [1000, key]),
        same("the returned payment shows the capture applied", pick(captured.value, "amountCaptured", "value"), 1000),
      ]);
      await session.standIn.settled();
      const read = await call(session, "GetPayment after the capture", "GetPayment", [id]);
      context.expect(read.folder, [same("the payment is succeeded with 1000 captured", [pick(read.value, "status"), pick(read.value, "amountCaptured", "value")], ["succeeded", 1000])]);
      const automatic = await pay(session, "CreatePayment captured by itself", CARDS.approved);
      const refused = await call(session, "CapturePayment on an automatic payment", "CapturePayment", [text(pick(automatic.value, "id")), fresh("key"), null, null]);
      context.expect(refused.folder, [
        same("capturing a payment Checkout.com captures by itself is refused as a state error", pick(thrown(refused), 0), "InvalidPaymentStateError"),
        same("no capture request went out for it", callsTo(session.standIn, "POST", `/payments/${text(pick(automatic.value, "id"))}/captures`).length, 0),
      ]);
    });
  },
};

const holdCancel: Journey = {
  title: "an authorized hold can be cancelled, which Checkout.com voids, and a payment waiting for 3-D Secure cannot",
  entryPoint: "`CancelPayment` through core",
  async run(context) {
    await withSession(context, async (session) => {
      const held = await pay(session, "CreatePayment authorize only", CARDS.approved, { request: { authorizeOnly: true } });
      const id = text(pick(held.value, "id"));
      const voided = await call(session, "CancelPayment", "CancelPayment", [id, fresh("key"), null]);
      context.expect(voided.folder, [
        answered(voided),
        same("Checkout.com received one void", callsTo(session.standIn, "POST", `/payments/${id}/voids`).length, 1),
        same("the payment reads canceled", pick(voided.value, "status"), "canceled"),
      ]);
      await session.standIn.settled();
      const provider = await paymentAtProvider(session, id);
      context.expect(voided.folder, [same("Checkout.com itself holds it as voided", pick(provider, "status"), "Voided")]);
      const waiting = await challenged(session, "CreatePayment challenged");
      const refused = await call(session, "CancelPayment of a payment waiting for 3-D Secure", "CancelPayment", [text(pick(waiting.value, "id")), fresh("key"), null]);
      context.expect(refused.folder, [
        same("cancelling a payment with no authorization yet is a state error", pick(thrown(refused), 0), "InvalidPaymentStateError"),
        same("Checkout.com refused the void it was asked for with a 403", callsTo(session.standIn, "POST", `/payments/${text(pick(waiting.value, "id"))}/voids`).map((entry) => entry.status), [403]),
      ]);
      context.expect(refused.folder, [same("the amount of the hold was the request's", pick(held.value, "amount"), EUR)]);
    });
  },
};

export const holdJourneys = { "hold-capture": holdCapture, "hold-cancel": holdCancel };
