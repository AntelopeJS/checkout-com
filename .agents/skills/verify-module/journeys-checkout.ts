import type { Journey } from "@antelopejs/tooling-configs/verify";

import { recordOf } from "./json.ts";
import { CARDS, EUR, answered, call, callsTo, customerAtProvider, fresh, onSandboxAndStandIn, onStandIn, pick, same, sent, thrown, text } from "./session.ts";

const METHOD_PREFIX = "antelope_method_";
const REQUEST = { amount: EUR, successUrl: "https://shop.invalid/ok", cancelUrl: "https://shop.invalid/cancel", description: "Order 42" };

const hostedSession: Journey = {
  title: "a checkout session is a hosted page with the amount, billing country and return URLs, reads pending until paid, then carries the payment it produced; a replay of its key returns the same page",
  entryPoint: "`CreateCheckoutSession` and `GetCheckoutSession` through core, the payer paying the page at the stand-in; stand-in only, since only a payer in a browser pays a hosted page",
  async run(context) {
    await onStandIn(context, async (session) => {
      const { standIn } = session.target;
      const reference = fresh("order");
      const key = fresh("key");
      const created = await call(session, "CreateCheckoutSession", "CreateCheckoutSession", [{ ...REQUEST, reference }, key, null]);
      const requested = callsTo(standIn, "POST", "/hosted-payments")[0]?.body;
      context.expect(created.folder, [
        answered(created),
        same("the session has a redirect URL and starts pending", [text(pick(created.value, "redirectUrl")).startsWith("http"), pick(created.value, "status")], [true, "pending"]),
        same("Checkout.com was asked for the amount, currency and reference", [pick(requested, "amount"), pick(requested, "currency"), pick(requested, "reference")], [2500, "EUR", reference]),
        same("it carries the configured billing country", pick(requested, "billing", "address", "country"), "FR"),
        same("the cancel URL is also the failure URL", [pick(requested, "success_url"), pick(requested, "cancel_url"), pick(requested, "failure_url")], ["https://shop.invalid/ok", "https://shop.invalid/cancel", "https://shop.invalid/cancel"]),
      ], { critical: true });
      const id = text(pick(created.value, "id"));
      const replay = await call(session, "CreateCheckoutSession replayed", "CreateCheckoutSession", [{ ...REQUEST, reference }, key, null]);
      context.expect(replay.folder, [
        same("the replay returns the same session", pick(replay.value, "id"), id),
        same("Checkout.com was asked once", callsTo(standIn, "POST", "/hosted-payments").length, 1),
      ]);
      const waiting = await call(session, "GetCheckoutSession before payment", "GetCheckoutSession", [id]);
      context.expect(waiting.folder, [same("an unpaid page reads pending with no payment", [pick(waiting.value, "status"), pick(waiting.value, "payment") ?? null], ["pending", null])]);
      const paymentId = standIn.payHostedPage(id, CARDS.approved);
      await standIn.settled();
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
  entryPoint: "`CreateCheckoutSession` on an account without `checkoutBillingCountry`, and `GetCheckoutSession` of an unknown id, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(
      context,
      async (session) => {
        const refused = await call(session, "CreateCheckoutSession without a billing country", "CreateCheckoutSession", [{ ...REQUEST, reference: fresh("order") }, fresh("key"), null]);
        context.expect(refused.folder, [
          same("the call is refused as a PaymentError", pick(thrown(refused), 0), "PaymentError"),
          same("the refusal names the billing country", text(pick(thrown(refused), 1)).includes("checkoutBillingCountry"), true),
          ...(await sent(session, ({ standIn }) => [same("no hosted page was requested from Checkout.com", callsTo(standIn, "POST", "/hosted-payments").length, 0)])),
        ]);
        const unknown = await call(session, "GetCheckoutSession of an unknown id", "GetCheckoutSession", ["hpp_000000000000"]);
        context.expect(unknown.folder, [same("an unknown session is not found", pick(thrown(unknown), 0), "PaymentNotFoundError")]);
      },
      { checkoutBillingCountry: null },
    );
  },
};

const hostedSavedCard: Journey = {
  title: "a card the payer saves on the hosted page is recorded on the customer once the session is read, and an off-session charge of it is chained to the payment that saved it",
  entryPoint: "`CreateCheckoutSession` with `customer` and `savePaymentMethod`, the payer paying the page at the stand-in, `GetCheckoutSession`, `ListPaymentMethods` and an `offSession` `CreatePayment` through core; stand-in only, since only a payer in a browser pays a hosted page",
  async run(context) {
    await onStandIn(context, async (session) => {
      const { standIn } = session.target;
      const customer = await call(session, "CreateCustomer", "CreateCustomer", [{ email: `${fresh("hedy")}@merchant.invalid` }, fresh("key"), null]);
      const customerId = text(pick(customer.value, "id"));
      const created = await call(session, "CreateCheckoutSession saving the card", "CreateCheckoutSession", [{ ...REQUEST, reference: fresh("order"), customer: customerId, savePaymentMethod: true }, fresh("key"), null]);
      const requested = callsTo(standIn, "POST", "/hosted-payments")[0]?.body;
      context.expect(created.folder, [
        answered(created),
        same("the page was asked to store the card", pick(requested, "payment_method_configuration", "card", "store_payment_details"), "enabled"),
        same("the page starts the series: Recurring, with 3-D Secure asking for the mandate", [pick(requested, "payment_type"), pick(requested, "3ds", "enabled"), pick(requested, "3ds", "challenge_indicator")], ["Recurring", true, "challenge_requested_mandate"]),
      ], { critical: true });
      const sessionId = text(pick(created.value, "id"));
      const savedAfter = Date.now();
      const paymentId = standIn.payHostedPage(sessionId, CARDS.approved);
      await standIn.settled();
      const paid = await call(session, "GetCheckoutSession after payment", "GetCheckoutSession", [sessionId]);
      context.expect(paid.folder, [answered(paid), same("the paid page carries the payment and it succeeded", [pick(paid.value, "payment"), pick(paid.value, "status")], [paymentId, "succeeded"])], { critical: true });
      const record = recordOf(pick(await customerAtProvider(session, customerId), "metadata"));
      const recorded = Object.keys(record).filter((key) => key.startsWith(METHOD_PREFIX));
      const method = (recorded[0] ?? "").slice(METHOD_PREFIX.length);
      const entry = text(record[recorded[0] ?? ""]).split(" ");
      context.expect(paid.folder, [
        same("reading the paid session recorded one card on the customer at Checkout.com, before anything listed it", [recorded.length, method.startsWith("src_")], [1, true]),
        same("the record holds the hosted payment under the card", entry[0], paymentId),
        same("followed by the time it was saved, in epoch milliseconds", [/^\d+$/.test(entry[1] ?? ""), Number(entry[1]) >= savedAfter && Number(entry[1]) <= Date.now()], [true, true]),
      ], { critical: true });
      const listed = await call(session, "ListPaymentMethods", "ListPaymentMethods", [customerId, null]);
      context.expect(listed.folder, [answered(listed), same("the customer lists that card", [pick(listed.value, 0, "id"), pick(listed.value, 0, "card", "last4")], [method, "6584"])], { critical: true });
      const reference = fresh("renewal");
      const charge = await call(session, "CreatePayment off-session", "CreatePayment", [{ amount: EUR, reference, customer: customerId, paymentMethod: method, offSession: true }, fresh("key"), null]);
      const chargeBody = callsTo(standIn, "POST", "/payments").find((entry) => pick(entry.body, "reference") === reference)?.body;
      context.expect(charge.folder, [
        answered(charge),
        same("the off-session charge is merchant-initiated and chained to the payment the hosted page made", [pick(chargeBody, "merchant_initiated"), pick(chargeBody, "previous_payment_id")], [true, paymentId]),
      ]);
    });
  },
};

export const checkoutJourneys = { "hosted-session": hostedSession, "hosted-refused": hostedRefused, "hosted-saved-card": hostedSavedCard };
