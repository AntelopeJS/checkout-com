export const TEST_WEBHOOK_KEY =
  "cko-suite-signature-key-never-used-by-a-workflow";
export const SECONDARY_WEBHOOK_KEY = "cko-suite-secondary-signature-key";
export const SECONDARY_WEBHOOK_AUTHORIZATION =
  "cko-suite-secondary-authorization";
export const TEST_BILLING_COUNTRY = "FR";

/** Sandbox test cards, from developer-resources/testing/test-cards. */
export const TEST_CARDS = {
  /** Visa, 3DS frictionless "Authentication successful"; approves (10000). */
  approved: "4485040371536584",
  /** Visa response-code test card: 20051 Insufficient funds. */
  insufficientFunds: "4544249167673670",
  /** Visa debit, 3DS challenge "Authentication successful". */
  challenge: "4010061700000021",
} as const;
