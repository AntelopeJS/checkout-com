import assert from "node:assert/strict";
import {
  CreateCustomer,
  CreatePayment,
  DetachPaymentMethod,
  GetCustomer,
  ListPaymentMethods,
  PAYMENT_METHOD_TYPES,
  type PaymentMethod,
} from "@antelopejs/interface-payment";

import { MintInstrument } from "./mint";
import { TEST_CARDS } from "./constants";
import { CurrentStandIn } from "./standin";
import type { JsonObject } from "./standin/wire";
import {
  CardToken,
  PassAuthentication,
  SUITE_TIMEOUT,
  Settled,
  SuiteTarget,
  email,
  key,
  reference,
} from "./support";

const EPOCH_MILLIS_FLOOR = Date.UTC(2020, 0, 1);
const RETURN_URL = "https://merchant.invalid/return";
const CHARGE = { value: 2500, currency: "EUR" };
const RENEWAL = { value: 1000, currency: "EUR" };
const METADATA_LIMIT = 20;

function chargedPaymentRequests(): JsonObject[] {
  return (CurrentStandIn()?.calls ?? [])
    .filter((call) => call.method === "POST" && call.path === "/payments")
    .map(({ body }) => body);
}

describe("[checkout-com] saved payment methods", function () {
  this.timeout(SUITE_TIMEOUT);

  it("saves a method against a customer and lists it back", async function () {
    const token = await CardToken(this, TEST_CARDS.approved);
    const customer = await CreateCustomer({ email: email() }, key());
    const payment = await PassAuthentication(
      this,
      await CreatePayment(
        {
          amount: CHARGE,
          reference: reference(),
          paymentMethod: token,
          customer: customer.id,
          savePaymentMethod: true,
          returnUrl: RETURN_URL,
        },
        key(),
      ),
    );
    assert.equal(payment.status, "succeeded");

    const methods = await ListPaymentMethods(customer.id);
    assert.equal(methods.length, 1, "the charged method must be saved");
    const [method] = methods;
    assert.equal(method.id, payment.paymentMethod);
    assert.equal(method.customer, customer.id);
    assert.ok(PAYMENT_METHOD_TYPES.includes(method.type));
    assert.ok(
      method.createdAt > EPOCH_MILLIS_FLOOR,
      "createdAt is when the module saved it",
    );
    assert.ok(method.card, "a card method must carry card details");
    assert.equal(method.card.last4, TEST_CARDS.approved.slice(-4));
    assert.ok(method.card.expiryYear >= new Date().getFullYear());

    const renewal = await CreatePayment(
      {
        amount: RENEWAL,
        reference: reference(),
        customer: customer.id,
        paymentMethod: method.id,
        offSession: true,
      },
      key(),
    );
    await Settled(renewal.id, "succeeded");

    await DetachPaymentMethod(method.id, key());
    const remaining = await ListPaymentMethods(customer.id);
    assert.ok(
      !remaining.some((entry: PaymentMethod) => entry.id === method.id),
    );
  });

  it("keeps its records out of the customer's metadata as callers see it", async function () {
    const token = await CardToken(this, TEST_CARDS.approved);
    const customer = await CreateCustomer(
      { email: email(), metadata: { tier: "gold" } },
      key(),
    );
    await PassAuthentication(
      this,
      await CreatePayment(
        {
          amount: CHARGE,
          reference: reference(),
          paymentMethod: token,
          customer: customer.id,
          savePaymentMethod: true,
          returnUrl: RETURN_URL,
        },
        key(),
      ),
    );
    assert.deepEqual((await GetCustomer(customer.id)).metadata, {
      tier: "gold",
    });
  });
});

describe("[checkout-com] saved payment methods without a record", function () {
  this.timeout(SUITE_TIMEOUT);

  it("charges a card saved some other way without a chain, and cannot date it", async function () {
    const target = SuiteTarget();
    if (!target.publicKey) this.skip();
    const customer = await CreateCustomer({ email: email() }, key());
    const instrument = await MintInstrument(
      target,
      TEST_CARDS.approved,
      customer.id,
    );
    const [method] = await ListPaymentMethods(customer.id);
    assert.equal(method.id, instrument);
    assert.equal(
      method.createdAt,
      0,
      "Checkout.com keeps no creation time for an instrument",
    );

    const charge = await CreatePayment(
      {
        amount: RENEWAL,
        reference: reference(),
        customer: customer.id,
        paymentMethod: instrument,
        offSession: true,
      },
      key(),
    );
    await Settled(charge.id, "succeeded");
    const [sent] = chargedPaymentRequests().slice(-1);
    if (sent)
      assert.equal(
        sent.previous_payment_id,
        undefined,
        "left to Checkout.com's own lookup",
      );
  });

  it("saves without a record when the customer's metadata is full", async function () {
    const token = await CardToken(this, TEST_CARDS.approved);
    const metadata = Object.fromEntries(
      Array.from({ length: METADATA_LIMIT - 1 }, (_, index) => [
        `field${index}`,
        "x",
      ]),
    );
    const customer = await CreateCustomer({ email: email(), metadata }, key());
    const payment = await PassAuthentication(
      this,
      await CreatePayment(
        {
          amount: CHARGE,
          reference: reference(),
          paymentMethod: token,
          customer: customer.id,
          savePaymentMethod: true,
          returnUrl: RETURN_URL,
        },
        key(),
      ),
    );
    assert.ok(payment.paymentMethod, "the payment itself is unaffected");
    const [method] = await ListPaymentMethods(customer.id);
    assert.equal(method.createdAt, 0);
    assert.deepEqual((await GetCustomer(customer.id)).metadata, metadata);
  });
});
