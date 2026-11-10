import assert from "node:assert/strict";
import {
  CreateCustomer,
  CreatePayment,
  CustomerNotFoundError,
  GetPayment,
  ListPaymentMethods,
} from "@antelopejs/interface-payment";

import { MintInstrument } from "./mint";
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
});
