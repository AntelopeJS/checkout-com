import assert from "node:assert/strict";
import { SUBSCRIPTION_METADATA_KEY } from "@antelopejs/interface-subscriptions";
import {
  CreateCustomer,
  CreatePayment,
  GetPayment,
  ListPaymentMethods,
} from "@antelopejs/interface-payment";

import { Subscriptions } from "./probe";
import { TEST_CARDS } from "./constants";
import { CurrentStandIn } from "./standin";
import {
  CardToken,
  ReadRaw,
  SUITE_TIMEOUT,
  WaitFor,
  email,
  key,
  reference,
} from "./support";

const PERIOD = { value: 1900, currency: "EUR" };
const ANCHOR_DELAY_MS = 2000;
const SECOND_MS = 1000;
const RETURN_URL = "https://merchant.invalid/return";

interface PaymentDetailsView {
  payment_type?: string;
}

function wholeSecondsFromNow(ms: number): number {
  return Math.ceil((Date.now() + ms) / SECOND_MS) * SECOND_MS;
}

async function savedCard(context: Mocha.Context) {
  const token = await CardToken(context, TEST_CARDS.approved);
  const customer = await CreateCustomer({ email: email() }, key());
  const saving = await CreatePayment(
    {
      amount: PERIOD,
      reference: reference(),
      customer: customer.id,
      paymentMethod: token,
      savePaymentMethod: true,
      returnUrl: RETURN_URL,
    },
    key(),
  );
  const [method] = await ListPaymentMethods(customer.id);
  assert.ok(method, "the saving payment must leave a method on the customer");
  assert.equal(method.id, saving.paymentMethod);
  return { customer: customer.id, method: method.id, saving: saving.id };
}

function assertChainedOnTheWire(
  subscription: string,
  saving: string,
  method: string,
): void {
  const standIn = CurrentStandIn();
  if (!standIn) return;
  const charges = standIn.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.path === "/payments" &&
      (call.body.metadata as Record<string, string> | undefined)?.[
        SUBSCRIPTION_METADATA_KEY
      ] === subscription,
  );
  assert.ok(
    charges.length > 0,
    "the fallback must have charged through this module",
  );
  for (const { body } of charges) {
    assert.equal(body.merchant_initiated, true);
    assert.equal(body.payment_type, "Recurring");
    assert.equal(body.previous_payment_id, saving);
    assert.deepEqual(body.source, { type: "id", id: method });
    assert.equal(body["3ds"], undefined, "an MIT carries no 3DS request");
  }
}

describe("[checkout-com] subscriptions from payment-subscriptions", function () {
  this.timeout(SUITE_TIMEOUT);

  it("charges a renewal off-session as a Recurring MIT chained to the payment that saved the card", async function () {
    const { customer, method, saving } = await savedCard(this);
    const anchor = wholeSecondsFromNow(ANCHOR_DELAY_MS);

    const { CreateSubscription, GetSubscription } = Subscriptions();
    const subscription = await CreateSubscription(
      {
        reference: reference(),
        customer,
        paymentMethod: method,
        amount: PERIOD,
        interval: "month",
        billingAnchor: anchor,
      },
      key(),
    );
    assert.equal(
      subscription.latestPayment,
      undefined,
      "nothing is charged before the anchor",
    );

    const renewed = await WaitFor(
      () => GetSubscription(subscription.id),
      (current) => current.latestPayment !== undefined,
      "the renewal clock charges at the anchor with nobody calling",
    );
    const charge = await WaitFor(
      () => GetPayment(renewed.latestPayment ?? ""),
      (payment) => payment.status === "succeeded",
      "the renewal charge settles",
    );
    assert.equal(charge.paymentMethod, method);
    assert.equal(charge.customer, customer);
    assert.equal(charge.metadata?.[SUBSCRIPTION_METADATA_KEY], subscription.id);
    assert.equal(charge.amount.value, PERIOD.value);

    const raw = await ReadRaw<PaymentDetailsView>(`/payments/${charge.id}`);
    assert.equal(raw.payment_type, "Recurring");
    assertChainedOnTheWire(subscription.id, saving, method);
  });
});
