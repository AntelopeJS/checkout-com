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

/**
 * Tests that need a refund to succeed at Checkout.com. They skip, with the
 * reason on stderr, only when the live run's setup found the sandbox unable to
 * refund (`CKO_TEST_REFUNDS_BLOCKED`); a run on an account with balance runs
 * them.
 */
const NEEDS_REFUND_BALANCE = new Set([
  "[checkout-com] refunds reports a refund pending until Checkout.com processes it",
  "[checkout-com] refunds reports an issuer's refusal of the refund as a failed call",
  "refunds (requires ANTELOPE_PAYMENT_TEST_METHOD) refunds part of a captured payment",
  "refunds (requires ANTELOPE_PAYMENT_TEST_METHOD) refuses to refund more than was captured",
]);

beforeEach(function () {
  const title = this.currentTest?.fullTitle() ?? "";
  if (EXCLUDED.has(title)) this.skip();
  const blocked = process.env.CKO_TEST_REFUNDS_BLOCKED;
  if (blocked && NEEDS_REFUND_BALANCE.has(title)) {
    process.stderr.write(`${blocked}: ${title}\n`);
    this.skip();
  }
});
