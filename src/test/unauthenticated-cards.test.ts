import assert from "node:assert/strict";
import {
  CreateCustomer,
  CreatePayment,
  CustomerNotFoundError,
  GetPayment,
  ListPaymentMethods,
} from "@antelopejs/interface-payment";

import { MintInstrument } from "./mint";
import { CurrentStandIn } from "./standin";
import { TEST_CARDS } from "./constants";
import {
  CardToken,
  SUITE_TIMEOUT,
  SuiteTarget,
  email,
  key,
  reference,
} from "./support";

const CHARGE = { value: 2500, currency: "EUR" };
const RETURN_URL = "https://merchant.invalid/return";

describe("[checkout-com] cards the payer never authenticated", function () {
  this.timeout(SUITE_TIMEOUT);

  it("lists no card for a saving payment still waiting for its payer", async function () {
    const customer = await CreateCustomer({ email: email() }, key());
    const saving = await CreatePayment(
      {
        amount: CHARGE,
        reference: reference(),
        paymentMethod: await CardToken(this, TEST_CARDS.approved),
        customer: customer.id,
        savePaymentMethod: true,
        returnUrl: RETURN_URL,
      },
      key(),
    );
    assert.equal(saving.status, "requires_action");
    assert.equal(
      saving.customer,
      customer.id,
      "the payment names its customer",
    );
    const read = await GetPayment(saving.id);
    assert.equal(read.customer, customer.id, "a read names it too");
    assert.deepEqual(
      await ListPaymentMethods(customer.id),
      [],
      "a card the payer has not authenticated is not the customer's",
    );
  });

  it("refuses an off-session charge for a customer of a card that customer does not have", async function () {
    const target = SuiteTarget();
    if (!target.publicKey) this.skip();
    const instrument = await MintInstrument(target, TEST_CARDS.approved);
    const customer = await CreateCustomer({ email: email() }, key());
    await assert.rejects(
      () =>
        CreatePayment(
          {
            amount: CHARGE,
            reference: reference(),
            customer: customer.id,
            paymentMethod: instrument,
            offSession: true,
          },
          key(),
        ),
      CustomerNotFoundError,
    );
  });

  it("names the requested customer on a saving payment of another customer's card", async function () {
    const target = SuiteTarget();
    if (!target.publicKey) this.skip();
    const owner = await CreateCustomer({ email: email() }, key());
    const instrument = await MintInstrument(
      target,
      TEST_CARDS.approved,
      owner.id,
    );
    const requester = await CreateCustomer({ email: email() }, key());
    const saving = await CreatePayment(
      {
        amount: CHARGE,
        reference: reference(),
        paymentMethod: instrument,
        customer: requester.id,
        savePaymentMethod: true,
        returnUrl: RETURN_URL,
      },
      key(),
    );
    assert.equal(saving.customer, requester.id);
    assert.equal((await GetPayment(saving.id)).customer, requester.id);
  });
});

describe("[checkout-com] the customer of a saving payment", function () {
  this.timeout(SUITE_TIMEOUT);

  it("refuses a saving payment for a customer that does not exist, before any charge", async function () {
    const absent = `cus_${"a".repeat(26)}`;
    const paymentReference = reference();
    const token = await CardToken(this, TEST_CARDS.approved);
    await assert.rejects(
      () =>
        CreatePayment(
          {
            amount: CHARGE,
            reference: paymentReference,
            paymentMethod: token,
            customer: absent,
            savePaymentMethod: true,
            returnUrl: RETURN_URL,
          },
          key(),
        ),
      CustomerNotFoundError,
    );
    const standIn = CurrentStandIn();
    if (!standIn) return;
    assert.equal(
      standIn.calls.filter(
        (call) =>
          call.path === "/payments" && call.body.reference === paymentReference,
      ).length,
      0,
      "no payment was sent",
    );
  });

  it("refuses a saving payment for a customer id that is not one, before any charge", async function () {
    const real = await CreateCustomer({ email: email() }, key());
    for (const disguised of [
      `cus_${"z".repeat(26)}/../${real.id}`,
      `${real.id}?x`,
      `${real.id}#x`,
      real.email ?? "",
    ]) {
      const token = await CardToken(this, TEST_CARDS.approved);
      await assert.rejects(
        () =>
          CreatePayment(
            {
              amount: CHARGE,
              reference: reference(),
              paymentMethod: token,
              customer: disguised,
              savePaymentMethod: true,
              returnUrl: RETURN_URL,
            },
            key(),
          ),
        CustomerNotFoundError,
        disguised,
      );
    }
  });
});
