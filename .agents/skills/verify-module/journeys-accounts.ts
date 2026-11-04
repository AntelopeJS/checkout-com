import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, answered, call, callsTo, fresh, pay, pick, same, thrown, withSession, text } from "./session.ts";

const accountSelection: Journey = {
  title: "the trailing provider argument selects a configured account, an unknown account is refused, and a wrong key at Checkout.com is an error to retry",
  entryPoint: "`CreatePayment`, `CreateCustomer` and `GetPayment` with and without a provider, through core",
  async run(context) {
    await withSession(context, async (session) => {
      const customer = await call(session, "CreateCustomer on the secondary account", "CreateCustomer", [{ email: `${fresh("sec")}@merchant.invalid` }, fresh("key"), "secondary"]);
      const customerId = text(pick(customer.value, "id"));
      const saving = await pay(session, "CreatePayment saving a card on the secondary account", CARDS.approved, { request: { customer: customerId, savePaymentMethod: true, returnUrl: "https://merchant.invalid/return" }, key: fresh("key"), provider: "secondary" });
      const method = text(pick(saving.value, "paymentMethod"));
      context.expect(saving.folder, [answered(customer), answered(saving)], { critical: true });
      const charge = await call(session, "CreatePayment off-session on the secondary account", "CreatePayment", [{ amount: { value: 2500, currency: "EUR" }, reference: fresh("renewal"), customer: customerId, paymentMethod: method, offSession: true }, fresh("key"), "secondary"]);
      context.expect(charge.folder, [
        answered(charge),
        same("the secondary account declares its charges as Unscheduled", pick(callsTo(session.standIn, "POST", "/payments")[1]?.body, "payment_type"), "Unscheduled"),
      ]);
      const unknown = await call(session, "CreatePayment on an unknown account", "CreatePayment", [{ amount: { value: 2500, currency: "EUR" }, reference: fresh("order"), paymentMethod: "src_00000000000000000000000000" }, fresh("key"), "nobody"]);
      context.expect(unknown.folder, [
        same("an account that is not configured is a PaymentError", pick(thrown(unknown), 0), "PaymentError"),
        same("no request went out for it", callsTo(session.standIn, "POST", "/payments").length, 2),
      ]);
    });
  },
};

const badKey: Journey = {
  title: "a secret key Checkout.com refuses is a PaymentError rather than a payment, and nothing is created",
  entryPoint: "`CreatePayment` through core with a module configured with a wrong secret key",
  async run(context) {
    await withSession(
      context,
      async (session) => {
        const refused = await call(session, "CreatePayment with a wrong key", "CreatePayment", [{ amount: { value: 2500, currency: "EUR" }, reference: fresh("order"), paymentMethod: "src_00000000000000000000000000" }, fresh("key"), null]);
        context.expect(refused.folder, [
          same("the call is a PaymentError", pick(thrown(refused), 0), "PaymentError"),
          same("Checkout.com answered 401", callsTo(session.standIn, "POST", "/payments").map((entry) => entry.status), [401]),
        ]);
      },
      { secretKey: "sk_sbox_wrongkey000000000000000000" },
    );
  },
};

export const accountJourneys = { "account-selection": accountSelection, "bad-key": badKey };
