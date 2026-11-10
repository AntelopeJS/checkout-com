import type { Journey } from "@antelopejs/tooling-configs/verify";

import { CARDS, EUR, acceptedPaymentRequest, answered, call, fresh, onSandboxAndStandIn, pay, pick, same, sent, settled, statusIs, text } from "./session.ts";

const requestContract: Journey = {
  title: "a payment through core reaches the configured base URL under the secret key, lands on that account, and reads back succeeded",
  entryPoint: "`CreatePayment` and `GetPayment` through core against the merchant's Checkout.com sandbox, then against the stand-in; the payment read back with the secret key at the configured base URL",
  async run(context) {
    await onSandboxAndStandIn(context, async (session) => {
      const reference = fresh("order");
      const created = await pay(session, "CreatePayment", CARDS.approved, { request: { reference } });
      context.expect(created.folder, [answered(created), ...(await sent(session, (target) => acceptedPaymentRequest(target, reference)))], { critical: true });
      const id = text(pick(created.value, "id"));
      const held = await settled(session, id, statusIs("Captured"));
      context.expect(created.folder, [
        same(
          "the account behind the configured base URL and secret key holds this payment, captured, with the amount, currency and reference sent",
          [pick(held, "id"), pick(held, "status"), pick(held, "amount"), pick(held, "currency"), pick(held, "reference")],
          [id, "Captured", EUR.value, EUR.currency, reference],
        ),
      ]);
      const read = await call(session, "GetPayment", "GetPayment", [id]);
      context.expect(read.folder, [answered(read), same("the payment reads succeeded", pick(read.value, "status"), "succeeded")]);
    });
  },
};

export const sandboxJourneys = { "request-contract": requestContract };
