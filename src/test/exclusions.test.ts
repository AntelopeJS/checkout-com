/**
 * Conformance tests this module does not run, each for a recorded reason, and
 * each replaced by a test of the same flow in this suite.
 *
 * "forgets a deleted customer" creates a customer with no email. Checkout.com
 * requires an email on every customer, and the module refuses rather than
 * inventing one (decided by Thomas on 2026-10-02).
 *
 * "saves a method against a customer and lists it back" saves the shared
 * ANTELOPE_PAYMENT_TEST_METHOD and then detaches it. Stripe's test method mints
 * a fresh payment method on every use; Checkout.com has no such thing, so the
 * shared method is a stored instrument, saving it links that very instrument
 * to the customer, and detaching deletes it — and every later charge test
 * fails for want of a method. The flow runs in saved-methods.test.ts with a
 * fresh card token, which is what a payer's browser would supply.
 */
const EXCLUDED = new Map([
  [
    "customers and saved payment methods forgets a deleted customer",
    "Checkout.com requires a customer email; see customers.test.ts",
  ],
  [
    "direct payments (requires ANTELOPE_PAYMENT_TEST_METHOD) saves a method against a customer and lists it back",
    "detaching would delete the shared test instrument; see saved-methods.test.ts",
  ],
]);

beforeEach(function () {
  const reason = EXCLUDED.get(this.currentTest?.fullTitle() ?? "");
  if (reason) this.skip();
});
