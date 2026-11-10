import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, answered, call, callsTo, fresh, onSandboxAndStandIn, onStandIn, pay, pick, same, sent, settled, statusIs, thrown, text, type Json, type Session } from "./session.ts";

const BALANCE_TOO_LOW = "50003";

function refunded(held: Json): Json | undefined {
  return pick(held, "balances", "total_refunded");
}

/** Ends the journey not verified when Checkout.com declined a refund of the payment for want of balance on the sandbox account, which no change to the module can fix. */
async function assertBalance(session: Session, id: string): Promise<void> {
  const actions = await session.target.request("GET", `/payments/${id}/actions`, session.target.keys.secretKey);
  const declined = Array.isArray(actions.json) && actions.json.some((action) => pick(action, "type") === "Refund" && pick(action, "response_code") === BALANCE_TOO_LOW);
  if (declined) session.context.notVerified(`not verified live: sandbox balance (${BALANCE_TOO_LOW}): the ${session.target.name} account has no balance to refund from`);
}

const refundFlow: Journey = {
  title: "a refund of part of a captured payment is accepted as pending with an id that names its payment, settles, and shows in the payment's refunded amount; more than is left is refused",
  entryPoint: "`RefundPayment`, `GetRefund` and `GetPayment` through core, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved);
      const id = text(pick(paid.value, "id"));
      const capturedFirst = await settled(session, id, statusIs("Captured"));
      context.expect(paid.folder, [answered(paid), same("Checkout.com holds the payment captured before the refund", pick(capturedFirst, "status"), "Captured")], { critical: true });
      const key = fresh("key");
      const refund = await call(session, "RefundPayment of 1000", "RefundPayment", [{ payment: id, amount: { value: 1000, currency: "EUR" }, reason: "requested_by_customer" }, key, null]);
      const refundId = text(pick(refund.value, "id"));
      context.expect(refund.folder, [
        answered(refund),
        same("the refund is pending and names its payment and amount", [pick(refund.value, "status"), pick(refund.value, "payment"), pick(refund.value, "amount", "value")], ["pending", id, 1000]),
        same("its id is the payment id and the action id", refundId.startsWith(`${id}:act_`), true),
        ...(await sent(session, ({ standIn }) => {
          const asked = callsTo(standIn, "POST", `/payments/${id}/refunds`)[0];
          return [same("Checkout.com received a refund of 1000 under the caller's key", [pick(asked?.body, "amount"), asked?.idempotencyKey ?? null], [1000, key])];
        })),
      ], { critical: true });
      const provider = await settled(session, id, (held) => refunded(held) === 1000);
      await assertBalance(session, id);
      const read = await call(session, "GetRefund", "GetRefund", [refundId]);
      const payment = await call(session, "GetPayment after the refund", "GetPayment", [id]);
      context.expect(read.folder, [
        answered(read),
        same("the settled refund reads succeeded", pick(read.value, "status"), "succeeded"),
        same("the payment shows 1000 refunded", pick(payment.value, "amountRefunded", "value"), 1000),
        same("Checkout.com holds the payment as partially refunded, 1000 of it", [pick(provider, "status"), refunded(provider)], ["Partially Refunded", 1000]),
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
  entryPoint: "`RefundPayment` through core after the stand-in's issuer was told to refuse the next refund; stand-in only, since the sandbox has no trigger for an issuer's refusal",
  async run(context) {
    await onStandIn(context, async (session) => {
      const paid = await pay(session, "CreatePayment", CARDS.approved, { request: { amount: { value: 5000, currency: "EUR" } } });
      const id = text(pick(paid.value, "id"));
      await session.target.standIn.settled();
      session.target.standIn.refuseNextRefund();
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
