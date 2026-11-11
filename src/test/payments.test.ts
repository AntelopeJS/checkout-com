import assert from "node:assert/strict";
import {
  CreateCustomer,
  CreatePayment,
  CustomerNotFoundError,
  GetPayment,
  GetRefund,
  ListPaymentMethods,
  PaymentError,
  RefundPayment,
} from "@antelopejs/interface-payment";

import { TEST_CARDS } from "./constants";
import { isPaymentDetails } from "./raw";
import { CurrentStandIn } from "./standin";
import { type JsonObject, ObjectOf } from "./standin/wire";
import {
  CardToken,
  Charge,
  IsLive,
  PassAuthentication,
  ReadRaw,
  RequireStandIn,
  SUITE_TIMEOUT,
  Settled,
  WaitFor,
  email,
  key,
  reference,
} from "./support";

const EUR = { value: 2500, currency: "EUR" };
const RETURN_URL = "https://merchant.invalid/return";

function lastPaymentRequest(): JsonObject {
  const calls = CurrentStandIn()?.calls ?? [];
  const call = calls
    .filter((each) => each.method === "POST" && each.path === "/payments")
    .pop();
  assert.ok(call, "a payment must have been requested");
  return call.body;
}

async function savingPayment(context: Mocha.Context, provider?: string) {
  const token = await CardToken(context, TEST_CARDS.approved);
  const customer = await CreateCustomer({ email: email() }, key(), provider);
  const created = await CreatePayment(
    {
      amount: EUR,
      reference: reference(),
      customer: customer.id,
      paymentMethod: token,
      savePaymentMethod: true,
      returnUrl: RETURN_URL,
    },
    key(),
    provider,
  );
  const payment = await PassAuthentication(context, created);
  return { customer: customer.id, payment };
}

describe("[checkout-com] how payments are declared to the schemes", function () {
  this.timeout(SUITE_TIMEOUT);

  it("starts a series with a customer-initiated payment that asks 3DS for the mandate", async function () {
    const { payment } = await savingPayment(this);
    assert.ok(
      payment.paymentMethod?.startsWith("src_"),
      "the card is stored as an instrument",
    );
    if (!CurrentStandIn()) return;
    const sent = lastPaymentRequest();
    assert.equal(sent.merchant_initiated, false);
    assert.equal(sent.payment_type, "Recurring");
    assert.deepEqual(sent["3ds"], {
      enabled: true,
      challenge_indicator: "challenge_requested_mandate",
    });
    assert.equal(ObjectOf(sent.source)?.store_for_future_use, true);
  });

  it("charges a saved card as a merchant-initiated payment chained to the one that saved it", async function () {
    const { customer, payment: saving } = await savingPayment(this);
    const [method] = await ListPaymentMethods(customer);
    const charge = await CreatePayment(
      {
        amount: EUR,
        reference: reference(),
        customer,
        paymentMethod: method.id,
        offSession: true,
      },
      key(),
    );
    assert.notEqual(charge.status, "requires_action");
    const raw = await ReadRaw(`/payments/${charge.id}`, isPaymentDetails);
    assert.equal(raw.payment_type, "Recurring");
    if (!CurrentStandIn()) return;
    const sent = lastPaymentRequest();
    assert.equal(sent.merchant_initiated, true);
    assert.equal(sent.previous_payment_id, saving.id);
    assert.equal(sent["3ds"], undefined);
  });

  it("declares saved-card charges as Unscheduled on an account configured so", async function () {
    const { customer } = await savingPayment(this, "secondary");
    const [method] = await ListPaymentMethods(customer, "secondary");
    const charge = await CreatePayment(
      {
        amount: EUR,
        reference: reference(),
        customer,
        paymentMethod: method.id,
        offSession: true,
      },
      key(),
      "secondary",
    );
    const raw = await ReadRaw(`/payments/${charge.id}`, isPaymentDetails);
    assert.equal(raw.payment_type, "Unscheduled");
  });

  it("reports a payment it will capture automatically as pending, not authorized", async function () {
    const created = await Charge(this);
    assert.equal(
      created.status,
      "pending",
      "Checkout.com's Authorized is not a hold here",
    );
    await Settled(created.id, "succeeded");
  });
});

describe("[checkout-com] one idempotency key", function () {
  this.timeout(SUITE_TIMEOUT);

  it("makes one payment of two concurrent calls under the same key", async function () {
    const method = process.env.ANTELOPE_PAYMENT_TEST_METHOD;
    if (!method) this.skip();
    const request = {
      amount: EUR,
      reference: reference(),
      paymentMethod: method,
      offSession: true,
    };
    const shared = key();
    const answers = await Promise.allSettled([
      CreatePayment(request, shared),
      CreatePayment(request, shared),
    ]);
    for (const answer of answers) {
      if (answer.status === "fulfilled") continue;
      const error: unknown = answer.reason;
      assert.ok(
        error instanceof PaymentError && error.name === "PaymentError",
        "a refused duplicate is a plain, retryable PaymentError",
      );
      assert.equal(error.providerCode, "duplicate_request");
    }
    const retried = await CreatePayment(request, shared);
    const ids = answers.flatMap((answer) =>
      answer.status === "fulfilled" ? [answer.value.id] : [],
    );
    assert.ok(
      ids.every((id) => id === retried.id),
      "every answer and the retry name one payment",
    );
    const standIn = CurrentStandIn();
    if (!standIn) return;
    const created = standIn.calls.filter(
      (call) => call.idempotencyKey === shared && !call.replayed,
    );
    assert.equal(created.length, 1, "Checkout.com created one payment");
  });
});

describe("[checkout-com] 3D Secure", function () {
  this.timeout(SUITE_TIMEOUT);

  async function challenged(context: Mocha.Context) {
    const token = await CardToken(context, TEST_CARDS.challenge);
    const customer = await CreateCustomer({ email: email() }, key());
    return CreatePayment(
      {
        amount: EUR,
        reference: reference(),
        customer: customer.id,
        paymentMethod: token,
        savePaymentMethod: true,
        returnUrl: RETURN_URL,
      },
      key(),
    );
  }

  it("sends the payer to Checkout.com's redirect and authorizes once they pass", async function () {
    const payment = await challenged(this);
    assert.equal(payment.status, "requires_action");
    assert.doesNotThrow(() => new URL(payment.redirectUrl ?? ""));
    const meanwhile = await GetPayment(payment.id);
    assert.equal(
      meanwhile.status,
      "requires_action",
      "a read still sees the redirect",
    );
    assert.equal(meanwhile.redirectUrl, payment.redirectUrl);
    if (IsLive()) return;
    RequireStandIn(this).completeChallenge(payment.id, true);
    await Settled(payment.id, "succeeded");
  });

  it("fails a payment whose payer does not pass 3DS", async function () {
    const payment = await challenged(this);
    RequireStandIn(this).completeChallenge(payment.id, false);
    const failed = await Settled(payment.id, "failed");
    assert.equal(failed.failure?.code, "authentication_failed");
    assert.equal(failed.failure?.providerCode, "20151");
  });
});

describe("[checkout-com] refusals before and at Checkout.com", function () {
  this.timeout(SUITE_TIMEOUT);

  it("refuses a payment with no method to charge", async () => {
    await assert.rejects(
      () =>
        CreatePayment(
          { amount: EUR, reference: reference(), returnUrl: RETURN_URL },
          key(),
        ),
      PaymentError,
    );
  });

  it("reports a method that is neither a token nor an instrument as not found", async () => {
    await assert.rejects(
      () =>
        CreatePayment(
          {
            amount: EUR,
            reference: reference(),
            paymentMethod: "pm_card_visa",
            offSession: true,
          },
          key(),
        ),
      CustomerNotFoundError,
    );
  });

  it("reads a decline's reason back from the payment's actions", async function () {
    const method = process.env.ANTELOPE_PAYMENT_TEST_METHOD_DECLINED;
    if (!method) this.skip();
    const declined = await Charge(this, { method });
    assert.equal(declined.failure?.code, "insufficient_funds");
    const read = await GetPayment(declined.id);
    assert.equal(read.failure?.code, "insufficient_funds");
    assert.equal(read.failure?.providerCode, "20051");
  });

  it("refuses a payment on an account it was not configured with", async () => {
    await assert.rejects(
      () => GetPayment(`pay_${"a".repeat(26)}`, "missing"),
      PaymentError,
    );
  });
});

describe("[checkout-com] refunds", function () {
  this.timeout(SUITE_TIMEOUT);

  it("reports a refund pending until Checkout.com processes it", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    const refund = await RefundPayment(
      { payment: payment.id, metadata: { ticket: "42" } },
      key(),
    );
    assert.equal(
      refund.amount.value,
      payment.amount.value,
      "no amount refunds the rest",
    );
    if (!IsLive()) {
      assert.equal(refund.status, "pending", "accepted, not yet processed");
    }
    const settled = await WaitFor(
      () => GetRefund(refund.id),
      ({ status }) => status === "succeeded",
      "the refund is processed",
    );
    assert.equal(settled.amount.value, payment.amount.value);
    assert.deepEqual(settled.metadata, { ticket: "42" });
  });

  it("reports an issuer's refusal of the refund as a failed call", async function () {
    const standIn = RequireStandIn(this);
    const payment = await Settled((await Charge(this)).id, "succeeded");
    standIn.refuseNextRefund();
    const error = await RefundPayment(
      { payment: payment.id, amount: { value: 1000, currency: "EUR" } },
      key(),
    ).catch((cause: unknown) => cause);
    assert.ok(error instanceof PaymentError);
    assert.equal(error.providerCode, "refund_authorization_declined");
  });
});
