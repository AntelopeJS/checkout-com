import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, answered, call, callsTo, fresh, pick, same, thrown, withSession, text } from "./session.ts";

const REQUEST = { amount: EUR, successUrl: "https://shop.invalid/ok", cancelUrl: "https://shop.invalid/cancel", description: "Order 42" };

const hostedSession: Journey = {
  title: "a checkout session is a hosted page with the amount, billing country and return URLs, reads pending until paid, then carries the payment it produced; a replay of its key returns the same page",
  entryPoint: "`CreateCheckoutSession` and `GetCheckoutSession` through core, the payer paying the page at the stand-in",
  async run(context) {
    await withSession(context, async (session) => {
      const reference = fresh("order");
      const key = fresh("key");
      const created = await call(session, "CreateCheckoutSession", "CreateCheckoutSession", [{ ...REQUEST, reference }, key, null]);
      const sent = callsTo(session.standIn, "POST", "/hosted-payments")[0]?.body;
      context.expect(created.folder, [
        answered(created),
        same("the session has a redirect URL and starts pending", [text(pick(created.value, "redirectUrl")).startsWith("http"), pick(created.value, "status")], [true, "pending"]),
        same("Checkout.com was asked for the amount, currency and reference", [pick(sent, "amount"), pick(sent, "currency"), pick(sent, "reference")], [2500, "EUR", reference]),
        same("it carries the configured billing country", pick(sent, "billing", "address", "country"), "FR"),
        same("the cancel URL is also the failure URL", [pick(sent, "success_url"), pick(sent, "cancel_url"), pick(sent, "failure_url")], ["https://shop.invalid/ok", "https://shop.invalid/cancel", "https://shop.invalid/cancel"]),
      ], { critical: true });
      const id = text(pick(created.value, "id"));
      const replay = await call(session, "CreateCheckoutSession replayed", "CreateCheckoutSession", [{ ...REQUEST, reference }, key, null]);
      context.expect(replay.folder, [
        same("the replay returns the same session", pick(replay.value, "id"), id),
        same("Checkout.com was asked once", callsTo(session.standIn, "POST", "/hosted-payments").length, 1),
      ]);
      const waiting = await call(session, "GetCheckoutSession before payment", "GetCheckoutSession", [id]);
      context.expect(waiting.folder, [same("an unpaid page reads pending with no payment", [pick(waiting.value, "status"), pick(waiting.value, "payment") ?? null], ["pending", null])]);
      const paymentId = session.standIn.payHostedPage(id, CARDS.approved);
      await session.standIn.settled();
      const paid = await call(session, "GetCheckoutSession after payment", "GetCheckoutSession", [id]);
      context.expect(paid.folder, [
        answered(paid),
        same("the paid page carries the payment Checkout.com produced", pick(paid.value, "payment"), paymentId),
        same("its status is the payment's own", pick(paid.value, "status"), "succeeded"),
      ]);
    });
  },
};

const hostedRefused: Journey = {
  title: "hosted checkout is refused without a configured billing country and for an unknown session",
  entryPoint: "`CreateCheckoutSession` on an account without `checkoutBillingCountry`, and `GetCheckoutSession` of an unknown id",
  async run(context) {
    await withSession(
      context,
      async (session) => {
        const refused = await call(session, "CreateCheckoutSession without a billing country", "CreateCheckoutSession", [{ ...REQUEST, reference: fresh("order") }, fresh("key"), null]);
        context.expect(refused.folder, [
          same("the call is refused as a PaymentError", pick(thrown(refused), 0), "PaymentError"),
          same("the refusal names the billing country", text(pick(thrown(refused), 1)).includes("checkoutBillingCountry"), true),
          same("no hosted page was requested from Checkout.com", callsTo(session.standIn, "POST", "/hosted-payments").length, 0),
        ]);
        const unknown = await call(session, "GetCheckoutSession of an unknown id", "GetCheckoutSession", ["hpp_000000000000"]);
        context.expect(unknown.folder, [same("an unknown session is not found", pick(thrown(unknown), 0), "PaymentNotFoundError")]);
      },
      { checkoutBillingCountry: null },
    );
  },
};

export const checkoutJourneys = { "hosted-session": hostedSession, "hosted-refused": hostedRefused };
