import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, answered, call, callsTo, fresh, pay, paymentAtProvider, pick, same, thrown, withSession, text } from "./session.ts";

const refundFlow: Journey = {
  title: "a refund of part of a captured payment is accepted as pending with an id that names its payment, settles, and shows in the payment's refunded amount; more than is left is refused",
  entryPoint: "`RefundPayment`, `GetRefund` and `GetPayment` through core",
  async run(context) {
    await withSession(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      await session.standIn.settled();
      const key = fresh("key");
      const refund = await call(session, "RefundPayment of 1000", "RefundPayment", [{ payment: id, amount: { value: 1000, currency: "EUR" }, reason: "requested_by_customer" }, key, null]);
      const refundId = text(pick(refund.value, "id"));
      const sent = callsTo(session.standIn, "POST", `/payments/${id}/refunds`)[0];
      context.expect(refund.folder, [
        answered(refund),
        same("the refund is pending and names its payment and amount", [pick(refund.value, "status"), pick(refund.value, "payment"), pick(refund.value, "amount", "value")], ["pending", id, 1000]),
        same("its id is the payment id and the action id", refundId.startsWith(`${id}:act_`), true),
        same("Checkout.com received a refund of 1000 under the caller's key", [pick(sent?.body, "amount"), sent?.idempotencyKey ?? null], [1000, key]),
      ], { critical: true });
      await session.standIn.settled();
      const read = await call(session, "GetRefund", "GetRefund", [refundId]);
      const payment = await call(session, "GetPayment after the refund", "GetPayment", [id]);
      const provider = await paymentAtProvider(session, id);
      context.expect(read.folder, [
        answered(read),
        same("the settled refund reads succeeded", pick(read.value, "status"), "succeeded"),
        same("the payment shows 1000 refunded", pick(payment.value, "amountRefunded", "value"), 1000),
        same("Checkout.com holds the payment as partially refunded", pick(provider, "status"), "Partially Refunded"),
      ]);
      const over = await call(session, "RefundPayment above the balance", "RefundPayment", [{ payment: id, amount: { value: 2000, currency: "EUR" } }, fresh("key"), null]);
      context.expect(over.folder, [same("a refund above what is left is a state error", pick(thrown(over), 0), "InvalidPaymentStateError")]);
      const absent = await call(session, "GetRefund of an unknown action", "GetRefund", [`${id}:act_00000000000000000000000000`]);
      context.expect(absent.folder, [same("an action the payment does not have is not found", pick(thrown(absent), 0), "PaymentNotFoundError")]);
    });
  },
};

const refundDeclined: Journey = {
  title: "an issuer that refuses a refund is a PaymentError that carries the code, and the refund is not left half made",
  entryPoint: "`RefundPayment` through core after the stand-in's issuer was told to refuse the next refund",
  async run(context) {
    await withSession(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved, { request: { amount: { value: 5000, currency: "EUR" } } });
      const id = text(pick(paid.value, "id"));
      await session.standIn.settled();
      session.standIn.refuseNextRefund();
      const refused = await call(session, "RefundPayment the issuer refuses", "RefundPayment", [{ payment: id, amount: { value: 1000, currency: "EUR" } }, fresh("key"), null]);
      context.expect(refused.folder, [
        same("the refusal is a PaymentError", pick(thrown(refused), 0), "PaymentError"),
        same("it carries Checkout.com's code", text(pick(thrown(refused), 1)).includes("refund_authorization_declined"), true),
      ]);
      const payment = await call(session, "GetPayment after the refused refund", "GetPayment", [id]);
      context.expect(payment.folder, [same("nothing was refunded", pick(payment.value, "amountRefunded", "value"), 0)]);
    });
  },
};

export const refundJourneys = { "refund-flow": refundFlow, "refund-declined": refundDeclined };
