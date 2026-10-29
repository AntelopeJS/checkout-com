import assert from "node:assert/strict";
import {
  CapturePayment,
  CreatePayment,
  CustomerNotFoundError,
  GetPayment,
  InvalidPaymentStateError,
  PaymentError,
  PaymentNotFoundError,
  RefundPayment,
} from "@antelopejs/interface-payment";

import { CurrentStandIn } from "./standin";
import { TranslateError } from "../implementations/payment/errors";
import {
  CkoApiError,
  type CkoErrorBody,
  CkoTransportError,
} from "../implementations/payment/http";
import {
  RequireStandIn,
  SUITE_TIMEOUT,
  WaitFor,
  key,
  reference,
} from "./support";

const ACTION_CONTEXT = { entity: "payment" as const, forbiddenIsState: true };
const EUR = "EUR";
const CHARGE = 2500;

function apiError(
  status: number,
  codes: string[] = [],
  type?: string,
): CkoApiError {
  const body: CkoErrorBody = { request_id: "suite", error_codes: codes };
  if (type) body.error_type = type;
  return new CkoApiError(status, body);
}

function assertRetryable(
  cause: unknown,
  label: string,
): asserts cause is PaymentError {
  assert.ok(cause instanceof PaymentError, `${label} must stay a PaymentError`);
  assert.equal(
    cause instanceof InvalidPaymentStateError,
    false,
    `${label} is not a refusal`,
  );
  assert.equal(
    cause instanceof PaymentNotFoundError,
    false,
    `${label} is not a not-found`,
  );
  assert.equal(
    cause instanceof CustomerNotFoundError,
    false,
    `${label} is not a not-found`,
  );
}

async function charged(): Promise<string> {
  const payment = await CreatePayment(
    {
      amount: { value: CHARGE, currency: EUR },
      reference: reference(),
      paymentMethod: process.env.ANTELOPE_PAYMENT_TEST_METHOD,
      offSession: true,
    },
    key(),
  );
  await WaitFor(
    () => GetPayment(payment.id),
    ({ status }) => status === "succeeded",
    "settles",
  );
  return payment.id;
}

describe("[checkout-com] translating Checkout.com's answers", () => {
  it("does not report an outage as a permanent refusal", () => {
    const outages = [
      apiError(401),
      apiError(409),
      apiError(429, ["duplicate_request"]),
      apiError(500),
      apiError(502),
      apiError(503),
      new CkoTransportError("socket hang up"),
    ];
    for (const outage of outages) {
      assertRetryable(
        TranslateError(outage, "pay_x", ACTION_CONTEXT),
        outage.message,
      );
    }
  });

  it("reads a bodiless 403 on an action as the payment's state", () => {
    const translated = TranslateError(apiError(403), "pay_x", ACTION_CONTEXT);
    assert.ok(translated instanceof InvalidPaymentStateError);
  });

  it("does not read a 403 elsewhere as the payment's state", () => {
    assertRetryable(
      TranslateError(apiError(403), "pay_x", { entity: "payment" }),
      "403",
    );
  });

  it("names the base URL when Checkout.com refuses it", () => {
    const translated = TranslateError(
      apiError(403, [], "base_url_invalid"),
      "pay_x",
      ACTION_CONTEXT,
    );
    assert.ok(translated instanceof PaymentError);
    assert.equal(translated instanceof InvalidPaymentStateError, false);
    assert.equal(translated.providerCode, "base_url_invalid");
    assert.match(translated.message, /baseUrl/);
  });

  it("reads balance codes as state and other validation codes as malformed calls", () => {
    const state = TranslateError(
      apiError(422, ["amount_exceeds_balance"]),
      "pay_x",
      ACTION_CONTEXT,
    );
    assert.ok(state instanceof InvalidPaymentStateError);
    assert.equal(state.providerCode, "amount_exceeds_balance");
    const malformed = TranslateError(
      apiError(422, ["currency_invalid"]),
      "pay_x",
      ACTION_CONTEXT,
    );
    assertRetryable(malformed, "currency_invalid");
    assert.equal(malformed.providerCode, "currency_invalid");
  });

  it("reads unknown customers and instruments as not found", () => {
    const customer = TranslateError(
      apiError(422, ["customer_not_found"]),
      "cus_x",
      ACTION_CONTEXT,
    );
    assert.ok(customer instanceof CustomerNotFoundError);
    const method = TranslateError(
      apiError(422, ["source_id_unknown"]),
      "src_x",
      ACTION_CONTEXT,
    );
    assert.ok(method instanceof CustomerNotFoundError);
  });
});

describe("[checkout-com] outages on the wire", function () {
  this.timeout(SUITE_TIMEOUT);

  afterEach(() => CurrentStandIn()?.clearFaults());

  it("keeps a 503 on a refund retryable", async function () {
    const standIn = RequireStandIn(this);
    const payment = await charged();
    standIn.injectFault({ kind: "status", status: 503 }, 2);
    const error = await RefundPayment({ payment }, key()).catch(
      (cause: unknown) => cause,
    );
    assertRetryable(error, "a 503 on refund");
  });

  it("keeps a dropped connection on a capture retryable", async function () {
    const standIn = RequireStandIn(this);
    const payment = await charged();
    standIn.injectFault({ kind: "drop" });
    const error = await CapturePayment(payment, key()).catch(
      (cause: unknown) => cause,
    );
    assertRetryable(error, "a dropped connection");
    assert.equal(error.providerCode, "unreachable");
  });

  it("keeps a 429 on a payment retryable", async function () {
    const standIn = RequireStandIn(this);
    standIn.injectFault({
      kind: "status",
      status: 429,
      body: {
        request_id: "x",
        error_type: "request_invalid",
        error_codes: ["duplicate_request"],
      },
    });
    const error = await GetPayment(`pay_${"a".repeat(26)}`).catch(
      (cause: unknown) => cause,
    );
    assertRetryable(error, "a 429");
  });
});
