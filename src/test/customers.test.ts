import assert from "node:assert/strict";
import {
  CreateCustomer,
  CustomerNotFoundError,
  DeleteCustomer,
  GetCustomer,
  PaymentError,
} from "@antelopejs/interface-payment";

import { CurrentStandIn } from "./standin";
import { isCustomer } from "./raw";
import { ReadRaw, SUITE_TIMEOUT, email, key } from "./support";

describe("[checkout-com] customers", function () {
  this.timeout(SUITE_TIMEOUT);

  it("refuses a customer without an email, and creates nothing", async () => {
    const before = CurrentStandIn()?.calls.filter(
      ({ path }) => path === "/customers",
    ).length;
    const error = await CreateCustomer({ name: "No Email" }, key()).catch(
      (cause: unknown) => cause,
    );
    assert.ok(error instanceof PaymentError);
    assert.equal(error.providerCode, "email_required");
    const after = CurrentStandIn()?.calls.filter(
      ({ path }) => path === "/customers",
    ).length;
    assert.equal(
      after,
      before,
      "the refusal is made before calling Checkout.com",
    );
  });

  it("forgets a deleted customer", async () => {
    const customer = await CreateCustomer({ email: email() }, key());
    await DeleteCustomer(customer.id, key());
    await assert.rejects(() => GetCustomer(customer.id), CustomerNotFoundError);
  });

  it("answers a replayed key with the first customer, from Checkout.com rather than memory", async () => {
    const address = email();
    const idempotencyKey = key();
    const first = await CreateCustomer(
      { email: address, name: "First" },
      idempotencyKey,
    );
    const replay = await CreateCustomer(
      { email: address, name: "First" },
      idempotencyKey,
    );
    assert.equal(replay.id, first.id);
    const raw = await ReadRaw(`/customers/${first.id}`, isCustomer);
    assert.ok(
      raw.metadata?.antelope_idempotency,
      "the key's fingerprint is kept on the customer",
    );
  });

  it("refuses an email another customer already has", async () => {
    const address = email();
    await CreateCustomer({ email: address }, key());
    const error = await CreateCustomer({ email: address }, key()).catch(
      (cause: unknown) => cause,
    );
    assert.ok(error instanceof PaymentError);
    assert.equal(error.providerCode, "customer_email_already_exists");
  });

  it("round-trips the caller's metadata without the module's own", async () => {
    const customer = await CreateCustomer(
      { email: email(), name: "Meta", metadata: { tier: "gold" } },
      key(),
    );
    assert.deepEqual(customer.metadata, { tier: "gold" });
    const read = await GetCustomer(customer.id);
    assert.deepEqual(read.metadata, { tier: "gold" });
    assert.equal(read.name, "Meta");
  });
});
