import type { SimCard } from "./state";

/**
 * How the sandbox treats a card, from Checkout.com's test-card pages
 * (developer-resources/testing/test-cards, fetched 2026-10-02).
 */
export interface CardBehaviour {
  responseCode: string;
  responseSummary: string;
  threeDs: "challenge" | "frictionless" | "not_enabled" | "upgrade";
}

const APPROVED = "10000";
const APPROVED_SUMMARY = "Approved";
const EXPIRED_CARD = "20054";
const NOT_ENROLLED = "20150";
const INSUFFICIENT_FUNDS = "20051";
const DECLINE_BY_AMOUNT_CARD = "4242424242424242";
const DECLINE_BY_AMOUNT = 101;

const approved = (threeDs: CardBehaviour["threeDs"]): CardBehaviour => ({
  responseCode: APPROVED,
  responseSummary: APPROVED_SUMMARY,
  threeDs,
});

const declined = (responseCode: string, responseSummary: string) => ({
  responseCode,
  responseSummary,
  threeDs: "frictionless" as const,
});

/** "Default cards", "Response code tests" and "3DS test cards". */
const BEHAVIOUR_BY_NUMBER: Record<string, CardBehaviour> = {
  "4242424242424242": approved("frictionless"),
  "4485040371536584": approved("frictionless"),
  "4010061700000021": approved("challenge"),
  "4532432452900131": approved("not_enabled"),
  "4500622868341387": approved("upgrade"),
  "4544249167673670": declined(INSUFFICIENT_FUNDS, "Insufficient Funds"),
  "4539467987109256": declined("20005", "Declined - Do not honour"),
};

function isExpired(card: SimCard, now: Date): boolean {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return (
    card.expiryYear < year ||
    (card.expiryYear === year && card.expiryMonth < month)
  );
}

/**
 * What an authorization of `amount` on `card` answers. 4242… declines with
 * 20051 for an amount of 101; an instrument stored with a past expiry declines
 * with 20054 ("Simulate an expired instrument").
 */
export function CardOutcome(card: SimCard, amount: number): CardBehaviour {
  if (isExpired(card, new Date())) {
    return declined(EXPIRED_CARD, "Expired Card");
  }
  if (card.number === DECLINE_BY_AMOUNT_CARD && amount === DECLINE_BY_AMOUNT) {
    return declined(INSUFFICIENT_FUNDS, "Insufficient Funds");
  }
  return BEHAVIOUR_BY_NUMBER[card.number] ?? approved("frictionless");
}

export function NotEnrolled(): CardBehaviour {
  return declined(NOT_ENROLLED, "Card not 3D-Secure enabled");
}

export function Scheme(card: SimCard): string {
  return card.number.startsWith("5") ? "Mastercard" : "Visa";
}
