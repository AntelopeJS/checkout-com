import assert from "node:assert/strict";
import {
  CancelPayment,
  CapturePayment,
  CreateCheckoutSession,
  CreatePayment,
  CreateCustomer,
  CustomerNotFoundError,
  GetPayment,
  GetRefund,
  InvalidPaymentStateError,
  ListPaymentMethods,
  PaymentNotFoundError,
  RefundPayment,
  VerifyWebhook,
} from "@antelopejs/interface-payment";

import { isActions } from "./raw";
import { TEST_CARDS, TEST_WEBHOOK_KEY } from "./constants";
import capturedFixture from "./standin/fixtures/payment_captured.json";
import {
  CardToken,
  Charge,
  ReadRaw,
  RequireStandIn,
  SUITE_TIMEOUT,
  Settled,
  Sign,
  email,
  key,
  reference,
} from "./support";

const EPOCH_MILLIS_FLOOR = Date.UTC(2020, 0, 1);
const PARTIAL = { value: 1000, currency: "EUR" };
const ABSENT_ACTION = `act_${"z".repeat(26)}`;

function actionsOf(payment: string) {
  return ReadRaw(`/payments/${payment}/actions`, isActions);
}

describe("[checkout-com] refunds that do not exist", function () {
  this.timeout(SUITE_TIMEOUT);

  it("reports an unknown refund action on a real payment as not found", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    await assert.rejects(
      () => GetRefund(`${payment.id}:${ABSENT_ACTION}`),
      PaymentNotFoundError,
    );
  });

  it("reports a capture action as no refund", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    const capture = (await actionsOf(payment.id)).find(
      ({ type }) => type === "Capture",
    );
    assert.ok(capture, "a captured payment lists its capture");
    await assert.rejects(
      () => GetRefund(`${payment.id}:${capture.id}`),
      PaymentNotFoundError,
    );
  });

  it("names the payment when refunding one that does not exist", async () => {
    const absent = `pay_${"z".repeat(26)}`;
    await assert.rejects(
      () => RefundPayment({ payment: absent }, key()),
      (cause: unknown) =>
        cause instanceof PaymentNotFoundError &&
        cause.message === `No such payment: ${absent}`,
    );
  });
});

describe("[checkout-com] capturing what Checkout.com captures by itself", function () {
  this.timeout(SUITE_TIMEOUT);

  it("refuses to capture a payment created for automatic capture", async function () {
    const payment = await Charge(this);
    await assert.rejects(
      () => CapturePayment(payment.id, key()),
      (cause: unknown) =>
        cause instanceof InvalidPaymentStateError &&
        cause.providerCode === "automatic_capture",
    );
    const settled = await Settled(payment.id, "succeeded");
    assert.equal(
      settled.amountCaptured.value,
      settled.amount.value,
      "captured exactly once",
    );
  });
});

describe("[checkout-com] actions on a payment waiting for 3DS", function () {
  this.timeout(SUITE_TIMEOUT);

  async function waiting(context: Mocha.Context) {
    const customer = await CreateCustomer({ email: email() }, key());
    const payment = await CreatePayment(
      {
        amount: PARTIAL,
        reference: reference(),
        customer: customer.id,
        paymentMethod: await CardToken(context, TEST_CARDS.challenge),
        savePaymentMethod: true,
        authorizeOnly: true,
        returnUrl: "https://merchant.invalid/return",
      },
      key(),
    );
    assert.equal(payment.status, "requires_action");
    return payment.id;
  }

  it("refuses to cancel it as a state error", async function () {
    const id = await waiting(this);
    await assert.rejects(
      () => CancelPayment(id, key()),
      InvalidPaymentStateError,
    );
  });

  it("refuses to capture it as a state error", async function () {
    const id = await waiting(this);
    await assert.rejects(
      () => CapturePayment(id, key()),
      InvalidPaymentStateError,
    );
  });
});

describe("[checkout-com] replayed actions", function () {
  this.timeout(SUITE_TIMEOUT);

  it("refunds once when a refund's key is replayed", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    const idempotencyKey = key();
    const first = await RefundPayment(
      { payment: payment.id, amount: PARTIAL },
      idempotencyKey,
    );
    const replay = await RefundPayment(
      { payment: payment.id, amount: PARTIAL },
      idempotencyKey,
    );
    assert.equal(replay.id, first.id);
    const refunds = (await actionsOf(payment.id)).filter(
      ({ type }) => type === "Refund",
    );
    assert.equal(refunds.length, 1, "a replayed key must not refund twice");
  });

  it("captures once when a capture's key is replayed", async function () {
    const payment = await Charge(this, { authorizeOnly: true });
    const idempotencyKey = key();
    const first = await CapturePayment(payment.id, idempotencyKey, PARTIAL);
    const replay = await CapturePayment(payment.id, idempotencyKey, PARTIAL);
    assert.equal(replay.amountCaptured.value, first.amountCaptured.value);
    assert.equal(replay.amountCaptured.value, PARTIAL.value);
    const captures = (await actionsOf(payment.id)).filter(
      ({ type }) => type === "Capture",
    );
    assert.equal(captures.length, 1, "a replayed key must not capture twice");
  });
});

describe("[checkout-com] hosted pages and customers", function () {
  this.timeout(SUITE_TIMEOUT);

  it("names the customer when a session is asked for one that does not exist", async () => {
    const absent = `cus_${"z".repeat(26)}`;
    await assert.rejects(
      () =>
        CreateCheckoutSession(
          {
            amount: PARTIAL,
            reference: reference(),
            successUrl: "https://merchant.invalid/success",
            cancelUrl: "https://merchant.invalid/cancel",
            customer: absent,
            savePaymentMethod: true,
          },
          key(),
        ),
      (cause: unknown) =>
        cause instanceof CustomerNotFoundError &&
        cause.message === `No such customer: ${absent}`,
    );
  });

  it("records a card saved on a hosted page from the payment's webhook alone", async function () {
    const standIn = RequireStandIn(this);
    const customer = await CreateCustomer({ email: email() }, key());
    const session = await CreateCheckoutSession(
      {
        amount: PARTIAL,
        reference: reference(),
        successUrl: "https://merchant.invalid/success",
        cancelUrl: "https://merchant.invalid/cancel",
        customer: customer.id,
        savePaymentMethod: true,
      },
      key(),
    );
    const paymentId = standIn.payHostedPage(session.id, TEST_CARDS.approved);
    await standIn.settled();

    const envelope = {
      ...capturedFixture,
      data: {
        ...capturedFixture.data,
        id: paymentId,
        metadata: { antelope_capture: "auto", antelope_save_for: customer.id },
      },
    };
    const body = JSON.stringify(envelope);
    await VerifyWebhook({
      body: Buffer.from(body),
      headers: { "cko-signature": Sign(body, TEST_WEBHOOK_KEY) },
    });

    const [method] = await ListPaymentMethods(customer.id);
    assert.equal(method.id, (await GetPayment(paymentId)).paymentMethod);
    assert.ok(
      method.createdAt > EPOCH_MILLIS_FLOOR,
      "recorded without GetCheckoutSession",
    );
  });
});
