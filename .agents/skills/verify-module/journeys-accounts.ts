import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, RETURN_URL, answered, call, callsTo, fresh, onSandboxAndStandIn, pay, paymentAtProvider, pick, same, sent, thrown, text } from "./session.ts";

const accountSelection: Journey = {
  title: "the trailing provider argument selects a configured account, and an unknown account is refused without a request",
  entryPoint: "`CreateCustomer` and `CreatePayment` with and without a provider, through core, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const customer = await call(session, "CreateCustomer on the secondary account", "CreateCustomer", [{ email: `${fresh("sec")}@merchant.invalid` }, fresh("key"), "secondary"]);
      const customerId = text(pick(customer.value, "id"));
      const saving = await pay(session, "CreatePayment saving a card on the secondary account", CARDS.approved, { request: { customer: customerId, savePaymentMethod: true, returnUrl: RETURN_URL }, provider: "secondary" });
      context.expect(saving.folder, [answered(customer), answered(saving)], { critical: true });
      const held = await paymentAtProvider(session, text(pick(saving.value, "id")));
      context.expect(saving.folder, [same("Checkout.com holds the payment with the secondary account's Unscheduled payment type, which only that account declares", pick(held, "payment_type"), "Unscheduled")]);
      const unknown = await call(session, "CreatePayment on an unknown account", "CreatePayment", [{ amount: { value: 2500, currency: "EUR" }, reference: fresh("order"), paymentMethod: "src_00000000000000000000000000" }, fresh("key"), "nobody"]);
      context.expect(unknown.folder, [
        same("an account that is not configured is a PaymentError", pick(thrown(unknown), 0), "PaymentError"),
        ...(await sent(session, ({ standIn }) => [same("no request went out for it", callsTo(standIn, "POST", "/payments").length, 1)])),
      ]);
    });
  },
};

const badKey: Journey = {
  title: "a secret key Checkout.com refuses is a PaymentError rather than a payment, and nothing is created",
  entryPoint: "`CreatePayment` through core with a module configured with a wrong sandbox secret key, against the Checkout.com sandbox, then against the stand-in",
  async run(context) {
    await onSandboxAndStandIn(
      context,
      async (session) => {
        const refused = await call(session, "CreatePayment with a wrong key", "CreatePayment", [{ amount: { value: 2500, currency: "EUR" }, reference: fresh("order"), paymentMethod: "src_00000000000000000000000000" }, fresh("key"), null]);
        context.expect(refused.folder, [
          same("the call is a PaymentError", pick(thrown(refused), 0), "PaymentError"),
          ...(await sent(session, ({ standIn }) => [same("Checkout.com answered 401", callsTo(standIn, "POST", "/payments").map((entry) => entry.status), [401])])),
        ]);
      },
      { secretKey: "sk_sbox_wrongkey000000000000000000" },
    );
  },
};

export const accountJourneys = { "account-selection": accountSelection, "bad-key": badKey };
