import assert from "node:assert/strict";
import {
  type CheckoutSessionRequest,
  CreateCheckoutSession,
  CreateCustomer,
  GetCheckoutSession,
  GetPayment,
  ListPaymentMethods,
  PaymentError,
} from "@antelopejs/interface-payment";

import { CurrentStandIn } from "./standin";
import { TEST_BILLING_COUNTRY, TEST_CARDS } from "./constants";
import {
  RequireStandIn,
  SUITE_TIMEOUT,
  WaitFor,
  email,
  key,
  reference,
} from "./support";

const EPOCH_MILLIS_FLOOR = Date.UTC(2020, 0, 1);

function session(
  overrides: Partial<CheckoutSessionRequest> = {},
): CheckoutSessionRequest {
  return {
    amount: { value: 4200, currency: "EUR" },
    reference: reference(),
    successUrl: "https://merchant.invalid/success",
    cancelUrl: "https://merchant.invalid/cancel",
    ...overrides,
  };
}

function lastHostedRequest(): Record<string, unknown> | undefined {
  const calls = CurrentStandIn()?.calls ?? [];
  return calls
    .filter(
      ({ method, path }) => method === "POST" && path === "/hosted-payments",
    )
    .pop()?.body;
}

describe("[checkout-com] hosted checkout", function () {
  this.timeout(SUITE_TIMEOUT);

  it("sends the configured billing country, and both return URLs", async () => {
    const created = await CreateCheckoutSession(
      session({ locale: "fr" }),
      key(),
    );
    assert.equal(created.status, "pending");
    const sent = lastHostedRequest();
    if (!sent) return;
    assert.deepEqual(sent.billing, {
      address: { country: TEST_BILLING_COUNTRY },
    });
    assert.equal(sent.failure_url, sent.cancel_url);
    assert.equal(sent.locale, "fr-FR");
  });

  it("refuses a session on an account with no billing country", async () => {
    await assert.rejects(
      () => CreateCheckoutSession(session(), key(), "secondary"),
      (error: unknown) =>
        error instanceof PaymentError &&
        /checkoutBillingCountry/.test(error.message),
    );
  });

  it("creates one page for concurrent calls with the same key", async () => {
    const idempotencyKey = key();
    const [first, second] = await Promise.all([
      CreateCheckoutSession(session(), idempotencyKey),
      CreateCheckoutSession(session(), idempotencyKey),
    ]);
    assert.equal(first.id, second.id);
  });

  it("follows a paid page to its payment", async function () {
    const standIn = RequireStandIn(this);
    const created = await CreateCheckoutSession(session(), key());
    const pending = await GetCheckoutSession(created.id);
    assert.equal(pending.status, "pending");
    assert.equal(
      pending.payment,
      undefined,
      'Checkout.com\'s literal "undefined" is not a payment',
    );
    assert.ok((pending.expiresAt ?? 0) > Date.now());

    const paymentId = standIn.payHostedPage(created.id, TEST_CARDS.approved);
    const paid = await WaitFor(
      () => GetCheckoutSession(created.id),
      ({ status }) => status === "succeeded",
      "the page's payment is captured",
    );
    assert.equal(paid.payment, paymentId);
    assert.ok((await GetPayment(paymentId)).createdAt > EPOCH_MILLIS_FLOOR);
  });

  it("holds an authorize-only page's payment for capture", async function () {
    const standIn = RequireStandIn(this);
    const created = await CreateCheckoutSession(
      session({ authorizeOnly: true }),
      key(),
    );
    standIn.payHostedPage(created.id, TEST_CARDS.approved);
    assert.equal((await GetCheckoutSession(created.id)).status, "authorized");
  });

  it("saves the card for the customer, and records it when the session is read", async function () {
    const standIn = RequireStandIn(this);
    const customer = await CreateCustomer({ email: email() }, key());
    const created = await CreateCheckoutSession(
      session({ customer: customer.id, savePaymentMethod: true }),
      key(),
    );
    const sent = lastHostedRequest();
    assert.deepEqual(sent?.payment_method_configuration, {
      card: { store_payment_details: "enabled" },
    });
    const sentCustomer = sent?.customer as Record<string, unknown> | undefined;
    assert.equal(
      typeof sentCustomer?.email,
      "string",
      "the customer is named by email",
    );

    standIn.payHostedPage(created.id, TEST_CARDS.approved);
    const read = await GetCheckoutSession(created.id);
    const [method] = await ListPaymentMethods(customer.id);
    assert.equal(
      method.id,
      (await GetPayment(read.payment ?? "")).paymentMethod,
    );
    assert.ok(
      method.createdAt > EPOCH_MILLIS_FLOOR,
      "recorded when the completed session was read",
    );
  });
});
