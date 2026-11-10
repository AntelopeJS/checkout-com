import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, RETURN_URL, answered, call, callsTo, customerAtProvider, fresh, passRedirect, pay, paymentAtProvider, pick, same, thrown, withSession, text } from "./session.ts";

const customerLifecycle: Journey = {
  title: "a customer needs an email, is found again with its details, has its email kept unique, and is gone once deleted",
  entryPoint: "`CreateCustomer`, `GetCustomer` and `DeleteCustomer` through core",
  async run(context) {
    await withSession(context, async (session) => {
      const email = `${fresh("ada")}@merchant.invalid`;
      const created = await call(session, "CreateCustomer", "CreateCustomer", [{ email, name: "Ada Lovelace", metadata: { plan: "gold" } }, fresh("key"), null]);
      context.expect(created.folder, [
        answered(created),
        same("the customer has the email, name and metadata given", [pick(created.value, "email"), pick(created.value, "name"), pick(created.value, "metadata")], [email, "Ada Lovelace", { plan: "gold" }]),
      ], { critical: true });
      const id = text(pick(created.value, "id"));
      const read = await call(session, "GetCustomer", "GetCustomer", [id]);
      context.expect(read.folder, [
        same("reading it back returns the same details and none of the module's own bookkeeping", [pick(read.value, "email"), pick(read.value, "metadata")], [email, { plan: "gold" }]),
      ]);
      const provider = await customerAtProvider(session, id);
      context.expect(read.folder, [same("Checkout.com holds the email and the caller's metadata", [pick(provider, "email"), pick(provider, "metadata", "plan")], [email, "gold"])]);
      const without = await call(session, "CreateCustomer without an email", "CreateCustomer", [{ name: "No Email" }, fresh("key"), null]);
      context.expect(without.folder, [
        same("a customer without an email is refused", pick(thrown(without), 0), "PaymentError"),
        same("the refusal names the missing email", text(pick(thrown(without), 1)).includes("email"), true),
      ]);
      const duplicate = await call(session, "CreateCustomer with a used email", "CreateCustomer", [{ email }, fresh("key"), null]);
      context.expect(duplicate.folder, [same("an email another customer has is refused", pick(thrown(duplicate), 0), "PaymentError")]);
      const unknown = await call(session, "GetCustomer of an unknown id", "GetCustomer", ["cus_00000000000000000000000000"]);
      context.expect(unknown.folder, [same("an unknown customer is a CustomerNotFoundError", pick(thrown(unknown), 0), "CustomerNotFoundError")]);
      const removed = await call(session, "DeleteCustomer", "DeleteCustomer", [id, fresh("key"), null]);
      context.expect(removed.folder, [answered(removed), same("Checkout.com received the delete", callsTo(session.standIn, "DELETE", `/customers/${id}`).length, 1)]);
      const gone = await call(session, "GetCustomer after the delete", "GetCustomer", [id]);
      context.expect(gone.folder, [same("the deleted customer is not found", pick(thrown(gone), 0), "CustomerNotFoundError")]);
    });
  },
};

const savedCard: Journey = {
  title: "a card saved by a payment that passed 3-D Secure is listed on its customer, charged off-session as a merchant-initiated payment chained to the saving payment, and gone once detached; the chain is recorded in the customer's metadata at Checkout.com",
  entryPoint: "`CreatePayment` with `savePaymentMethod`, the payer opening its 3-D Secure redirect, `GetPayment`, `ListPaymentMethods`, an `offSession` `CreatePayment` and `DetachPaymentMethod` through core",
  async run(context) {
    await withSession(context, async (session) => {
      const customer = await call(session, "CreateCustomer", "CreateCustomer", [{ email: `${fresh("grace")}@merchant.invalid` }, fresh("key"), null]);
      const customerId = text(pick(customer.value, "id"));
      const saving = await pay(session, "CreatePayment saving the card", CARDS.approved, { request: { customer: customerId, savePaymentMethod: true, returnUrl: RETURN_URL } });
      const savingId = text(pick(saving.value, "id"));
      const savingBody = callsTo(session.standIn, "POST", "/payments")[0]?.body;
      context.expect(saving.folder, [
        answered(saving),
        same("the saving payment waits for the payer's 3-D Secure, as every 3-D Secure payment does at Checkout.com", pick(saving.value, "status"), "requires_action"),
        same("the saving payment starts the series, customer-initiated and with the mandate asked of 3-D Secure", [pick(savingBody, "merchant_initiated"), pick(savingBody, "payment_type"), pick(savingBody, "3ds", "challenge_indicator"), pick(savingBody, "source", "store_for_future_use")], [false, "Recurring", "challenge_requested_mandate", true]),
      ], { critical: true });
      const authenticated = await passRedirect(session, "GetPayment after the payer passed 3-D Secure", saving);
      const method = text(pick(authenticated.value, "paymentMethod"));
      context.expect(authenticated.folder, [
        answered(authenticated),
        same("the payment succeeded and the card is stored as an instrument", [pick(authenticated.value, "status"), method.startsWith("src_")], ["succeeded", true]),
      ], { critical: true });
      const listed = await call(session, "ListPaymentMethods", "ListPaymentMethods", [customerId, null]);
      context.expect(listed.folder, [
        answered(listed),
        same("the customer has the one saved card, with its brand and last digits", [pick(listed.value, 0, "id"), pick(listed.value, 0, "card", "last4"), pick(listed.value, 0, "customer")], [method, "6584", customerId]),
      ]);
      const charge = await call(session, "CreatePayment off-session", "CreatePayment", [{ amount: EUR, reference: fresh("renewal"), customer: customerId, paymentMethod: method, offSession: true }, fresh("key"), null]);
      const chargeBody = callsTo(session.standIn, "POST", "/payments")[1]?.body;
      context.expect(charge.folder, [
        answered(charge),
        same("the off-session charge is merchant-initiated, Recurring and chained to the saving payment", [pick(chargeBody, "merchant_initiated"), pick(chargeBody, "payment_type"), pick(chargeBody, "previous_payment_id")], [true, "Recurring", savingId]),
        same("it asks for no 3-D Secure", pick(chargeBody, "3ds") ?? null, null),
      ]);
      await session.standIn.settled();
      const held = await paymentAtProvider(session, text(pick(charge.value, "id")));
      context.expect(charge.folder, [same("Checkout.com holds the charge as captured", pick(held, "status"), "Captured")]);
      const record = await customerAtProvider(session, customerId);
      const entry = pick(record, "metadata", `antelope_method_${method}`);
      context.expect(charge.folder, [
        same("the customer's metadata at Checkout.com records the saving payment under the card", text(entry).startsWith(`${savingId} `), true),
        same("the customer the module returns hides that record", pick((await call(session, "GetCustomer", "GetCustomer", [customerId])).value, "metadata") ?? null, null),
      ]);
      const detached = await call(session, "DetachPaymentMethod", "DetachPaymentMethod", [method, fresh("key"), null]);
      const after = await call(session, "ListPaymentMethods after the detach", "ListPaymentMethods", [customerId, null]);
      context.expect(after.folder, [answered(detached), same("the customer has no saved card left", after.value, [])]);
      const unknown = await call(session, "ListPaymentMethods of an unknown customer", "ListPaymentMethods", ["cus_00000000000000000000000000", null]);
      context.expect(unknown.folder, [same("an unknown customer is a CustomerNotFoundError", pick(thrown(unknown), 0), "CustomerNotFoundError")]);
    });
  },
};

export const customerJourneys = { "customer-lifecycle": customerLifecycle, "saved-card": savedCard };
