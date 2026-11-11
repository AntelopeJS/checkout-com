import assert from "node:assert/strict";
import {
  CancelPayment,
  PAYMENT_EVENT_TYPES,
  type PaymentEvent,
  PaymentError,
  PaymentNotFoundError,
  RefundPayment,
  VerifyWebhook,
  type WebhookRequest,
  WebhookVerificationError,
} from "@antelopejs/interface-payment";

import { ParseRefundId } from "../implementations/payment/ids";
import voidedFixture from "./standin/fixtures/payment_voided.json";
import disputeFixture from "./standin/fixtures/dispute_received.json";
import { Charge, SUITE_TIMEOUT, Settled, Sign, key } from "./support";
import approvedFixture from "./standin/fixtures/payment_approved.json";
import capturedFixture from "./standin/fixtures/payment_captured.json";
import declinedFixture from "./standin/fixtures/payment_declined.json";
import refundedFixture from "./standin/fixtures/payment_refunded.json";
import cardVerifiedFixture from "./standin/fixtures/card_verified.json";
import refundDeclinedFixture from "./standin/fixtures/payment_refund_declined.json";
import {
  SECONDARY_WEBHOOK_AUTHORIZATION,
  SECONDARY_WEBHOOK_KEY,
  TEST_WEBHOOK_KEY,
} from "./constants";

interface DeliveryData {
  id?: string;
  action_id?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string>;
}

const EPOCH_MILLIS_FLOOR = Date.UTC(2020, 0, 1);

function delivery(
  fixture: { data: object },
  data: DeliveryData,
  signatureKey = TEST_WEBHOOK_KEY,
): WebhookRequest {
  const envelope = { ...fixture, data: { ...fixture.data, ...data } };
  const body = JSON.stringify(envelope);
  return {
    body: Buffer.from(body),
    headers: {
      "cko-signature": Sign(body, signatureKey),
      "content-type": "application/json",
    },
  };
}

function assertEvent(
  event: PaymentEvent | undefined,
  type: string,
  fixture: { id: string },
): PaymentEvent {
  assert.ok(event, `a ${type} delivery must produce an event`);
  assert.equal(event.type, type);
  assert.ok(PAYMENT_EVENT_TYPES.includes(event.type));
  assert.equal(event.id, fixture.id);
  assert.ok(
    event.createdAt > EPOCH_MILLIS_FLOOR,
    "createdAt must be epoch milliseconds",
  );
  return event;
}

describe("[checkout-com] webhook normalisation", function () {
  this.timeout(SUITE_TIMEOUT);

  it("reports a capture as payment.succeeded, from the payment as the API holds it", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    const event = assertEvent(
      await VerifyWebhook(
        delivery(capturedFixture, { id: payment.id, action_id: "act_x" }),
      ),
      "payment.succeeded",
      capturedFixture,
    );
    assert.equal(event.payment?.id, payment.id);
    assert.equal(event.payment?.status, "succeeded");
    assert.equal(event.payment?.amountCaptured.value, payment.amount.value);
    assert.equal(event.createdAt, Date.parse(capturedFixture.timestamp));
  });

  it("reports an approval it must act on as payment.authorized", async function () {
    const payment = await Charge(this, { authorizeOnly: true });
    const event = assertEvent(
      await VerifyWebhook(
        delivery(approvedFixture, {
          id: payment.id,
          metadata: { antelope_capture: "manual" },
        }),
      ),
      "payment.authorized",
      approvedFixture,
    );
    assert.equal(event.payment?.status, "authorized");
    assert.equal(event.createdAt, Date.parse(approvedFixture.created_on));
  });

  it("stays silent on an approval Checkout.com will capture by itself", async function () {
    const payment = await Charge(this);
    const event = await VerifyWebhook(
      delivery(approvedFixture, {
        id: payment.id,
        metadata: { antelope_capture: "auto" },
      }),
    );
    assert.equal(event, undefined);
  });

  it("reports a decline as payment.failed, with the reason", async function () {
    const method = process.env.ANTELOPE_PAYMENT_TEST_METHOD_DECLINED;
    if (!method) this.skip();
    const payment = await Charge(this, { method });
    const event = assertEvent(
      await VerifyWebhook(delivery(declinedFixture, { id: payment.id })),
      "payment.failed",
      declinedFixture,
    );
    assert.equal(event.payment?.failure?.code, "insufficient_funds");
    assert.equal(event.payment?.failure?.providerCode, "20051");
  });

  it("reports a void as payment.canceled", async function () {
    const payment = await Charge(this, { authorizeOnly: true });
    await CancelPayment(payment.id, key());
    const event = assertEvent(
      await VerifyWebhook(delivery(voidedFixture, { id: payment.id })),
      "payment.canceled",
      voidedFixture,
    );
    assert.equal(event.payment?.status, "canceled");
  });

  it("reports a refund under the identifier RefundPayment returned", async function () {
    const payment = await Settled((await Charge(this)).id, "succeeded");
    const refund = await RefundPayment(
      { payment: payment.id, amount: { value: 700, currency: "EUR" } },
      key(),
    );
    const { action } = ParseRefundId(refund.id);
    const event = assertEvent(
      await VerifyWebhook(
        delivery(refundedFixture, {
          id: payment.id,
          action_id: action,
          amount: 700,
          currency: "EUR",
        }),
      ),
      "refund.succeeded",
      refundedFixture,
    );
    assert.equal(event.refund?.id, refund.id);
    assert.equal(event.refund?.payment, payment.id);
    assert.equal(event.refund?.status, "succeeded");
    assert.deepEqual(event.refund?.amount, { value: 700, currency: "EUR" });
  });
});

describe("[checkout-com] webhooks for actions Checkout.com declined", function () {
  this.timeout(SUITE_TIMEOUT);

  it("reports a capture declined after its 202 as the hold it leaves", async function () {
    const payment = await Charge(this, { authorizeOnly: true });
    const captureDeclined = {
      ...capturedFixture,
      type: "payment_capture_declined",
    };
    const event = assertEvent(
      await VerifyWebhook(delivery(captureDeclined, { id: payment.id })),
      "payment.authorized",
      captureDeclined,
    );
    assert.equal(event.payment?.status, "authorized");
  });

  it("reports a declined void as the hold it leaves", async function () {
    const payment = await Charge(this, { authorizeOnly: true });
    const voidDeclined = { ...voidedFixture, type: "payment_void_declined" };
    const event = assertEvent(
      await VerifyWebhook(delivery(voidDeclined, { id: payment.id })),
      "payment.authorized",
      voidDeclined,
    );
    assert.equal(event.payment?.status, "authorized");
  });

  it("reports a failed authentication as payment.failed", async function () {
    const method = process.env.ANTELOPE_PAYMENT_TEST_METHOD_DECLINED;
    if (!method) this.skip();
    const payment = await Charge(this, { method });
    const authenticationFailed = {
      ...declinedFixture,
      type: "payment_authentication_failed",
    };
    const event = assertEvent(
      await VerifyWebhook(delivery(authenticationFailed, { id: payment.id })),
      "payment.failed",
      authenticationFailed,
    );
    assert.equal(event.payment?.status, "failed");
  });
});

describe("[checkout-com] webhook normalisation from the body alone", function () {
  this.timeout(SUITE_TIMEOUT);

  it("reports a declined refund as refund.failed", async () => {
    const event = assertEvent(
      await VerifyWebhook(delivery(refundDeclinedFixture, {})),
      "refund.failed",
      refundDeclinedFixture,
    );
    assert.equal(event.refund?.status, "failed");
    assert.ok(event.refund?.failure, "a failed refund must say why");
  });

  it("reports a received dispute from the signed body", async () => {
    const event = assertEvent(
      await VerifyWebhook(delivery(disputeFixture, {})),
      "dispute.opened",
      disputeFixture,
    );
    const { data } = disputeFixture;
    assert.equal(event.dispute?.id, data.id);
    assert.equal(event.dispute?.payment, data.payment_id);
    assert.deepEqual(event.dispute?.amount, {
      value: data.amount,
      currency: data.currency,
    });
    assert.equal(event.dispute?.reason, data.category);
    assert.equal(event.dispute?.createdAt, Date.parse(data.date));
  });

  it("resolves undefined for a genuine delivery it does not model", async () => {
    assert.equal(
      await VerifyWebhook(delivery(cardVerifiedFixture, {})),
      undefined,
    );
  });

  it("rejects, for redelivery, a payment event naming a payment the account does not have", async () => {
    await assert.rejects(
      () =>
        VerifyWebhook(
          delivery(capturedFixture, { id: `pay_${"z".repeat(26)}` }),
        ),
      PaymentNotFoundError,
    );
  });
});

describe("[checkout-com] webhook verification", () => {
  const body = JSON.stringify(cardVerifiedFixture);

  function request(
    headers: Record<string, string>,
    raw = body,
  ): WebhookRequest {
    return { body: Buffer.from(raw), headers };
  }

  it("accepts the signature in either hex case", async () => {
    const signature = Sign(body, TEST_WEBHOOK_KEY).toUpperCase();
    assert.equal(
      await VerifyWebhook(request({ "Cko-Signature": signature })),
      undefined,
    );
  });

  it("refuses a signature made with another key", async () => {
    await assert.rejects(
      () =>
        VerifyWebhook(request({ "cko-signature": Sign(body, "another key") })),
      WebhookVerificationError,
    );
  });

  it("refuses a body edited after signing", async () => {
    const edited = body.replace("card_verified", "payment_captured");
    await assert.rejects(
      () =>
        VerifyWebhook(
          request({ "cko-signature": Sign(body, TEST_WEBHOOK_KEY) }, edited),
        ),
      WebhookVerificationError,
    );
  });

  it("refuses a header that is not a digest", async () => {
    await assert.rejects(
      () => VerifyWebhook(request({ "cko-signature": "t=0,v1=00" })),
      WebhookVerificationError,
    );
  });

  it("refuses a delivery for another account's key", async () => {
    await assert.rejects(
      () =>
        VerifyWebhook(
          request({
            "cko-signature": Sign(body, TEST_WEBHOOK_KEY),
            authorization: SECONDARY_WEBHOOK_AUTHORIZATION,
          }),
          "secondary",
        ),
      WebhookVerificationError,
    );
  });

  it("requires the Authorization value an account was given", async () => {
    const signature = Sign(body, SECONDARY_WEBHOOK_KEY);
    await assert.rejects(
      () => VerifyWebhook(request({ "cko-signature": signature }), "secondary"),
      WebhookVerificationError,
    );
    await assert.rejects(
      () =>
        VerifyWebhook(
          request({ "cko-signature": signature, authorization: "guess" }),
          "secondary",
        ),
      WebhookVerificationError,
    );
    assert.equal(
      await VerifyWebhook(
        request({
          "cko-signature": signature,
          authorization: SECONDARY_WEBHOOK_AUTHORIZATION,
        }),
        "secondary",
      ),
      undefined,
    );
  });

  it("does not take a genuine but unparseable body for a forgery", async () => {
    const raw = "not json";
    const error = await VerifyWebhook(
      request({ "cko-signature": Sign(raw, TEST_WEBHOOK_KEY) }, raw),
    ).catch((cause: unknown) => cause);
    assert.ok(error instanceof PaymentError);
    assert.equal(error instanceof WebhookVerificationError, false);
  });

  it("resolves undefined for a genuine delivery of a type it does not model, whatever its data holds", async () => {
    for (const raw of [
      '{"id":"evt_1","type":"source_updated","data":{"source_id":"src_1"}}',
      '{"id":"evt_2","type":"payment_authorization_increment_declined","data":{"id":"pay_1","metadata":{"a":{"b":1}}}}',
      '{"id":"evt_3","type":"card_verified","created_on":null,"data":{"id":"pay_1"}}',
      '{"id":"evt_4","type":"payment_pending_x","data":{"id":"pay_1","amount":"20"}}',
    ]) {
      assert.equal(
        await VerifyWebhook(
          request({ "cko-signature": Sign(raw, TEST_WEBHOOK_KEY) }, raw),
        ),
        undefined,
        raw,
      );
    }
  });

  it("refuses a genuine body that is JSON but not an event envelope", async () => {
    for (const raw of [
      "null",
      "{}",
      '{"id":"evt_1","type":"payment_captured"}',
      '{"id":"evt_1","type":"source_updated","data":[]}',
      '{"type":"source_updated","data":{}}',
      '{"id":"evt_1","type":"payment_captured","data":{"amount":"20"}}',
    ]) {
      const error = await VerifyWebhook(
        request({ "cko-signature": Sign(raw, TEST_WEBHOOK_KEY) }, raw),
      ).catch((cause: unknown) => cause);
      assert.ok(error instanceof PaymentError, `${raw} is refused`);
      assert.equal(error instanceof WebhookVerificationError, false);
    }
  });
});
