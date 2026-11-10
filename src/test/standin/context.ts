import type { SimState } from "./state";
import type { CardBehaviour } from "./cards";
import type { StandInReply } from "./server";
import { type JsonValue, isCount, isText } from "./wire";

const UNPROCESSABLE = 422;
const ACTION_DELAY_MS = 60;

interface SimEvent {
  type: string;
  payment: string;
}

interface PendingChallenge {
  behaviour: CardBehaviour;
  commit: (isApproved: boolean) => void;
}

/** Everything a stand-in handler reads or changes. */
export interface SimContext {
  state: SimState;
  baseUrl: string;
  events: SimEvent[];
  challenges: Map<string, PendingChallenge>;
  /** Refund requests the issuer will refuse outright, next first. */
  issuerRefusals: number;
  /** Applies an accepted action later, as Checkout.com does. */
  later(apply: () => void): void;
  /** Resolves once every action accepted so far has been applied. */
  settled(): Promise<void>;
}

/** A Checkout.com error answer, thrown out of a handler. */
export class SimError extends Error {
  constructor(readonly reply: StandInReply) {
    super(`stand-in answered ${reply.status}`);
  }
}

/** A 422 `ValidationError`, shaped as the spec documents it. */
export function Problem(code: string): StandInReply {
  return {
    status: UNPROCESSABLE,
    body: {
      request_id: "0HL80RJLS76I7",
      error_type: "request_invalid",
      error_codes: [code],
    },
  };
}

/** A payment amount that passed the rules of {@link ParseAmount}. */
export interface Amount {
  currency: string;
  value: number;
}

/**
 * A currency code and a non-negative whole number of minor units. "Format the
 * amount value" also asks three-decimal currencies to end in 0 and CLP in 00,
 * but the sandbox authorizes and captures KWD 1001, BHD 1005 and CLP 150
 * (observed 2026-11-10), so the stand-in does not refuse them either.
 */
export function ParseAmount(
  currency: JsonValue | undefined,
  amount: JsonValue | undefined,
): Amount {
  if (!isText(currency) || currency.length !== 3) {
    throw new SimError(Problem("currency_required"));
  }
  if (!isCount(amount) || !Number.isInteger(amount) || amount < 0) {
    throw new SimError(Problem("amount_invalid"));
  }
  return { currency, value: amount };
}

export function NewContext(state: SimState, baseUrl: string): SimContext {
  const pending = new Set<Promise<void>>();
  return {
    state,
    baseUrl,
    events: [],
    challenges: new Map(),
    issuerRefusals: 0,
    later(apply) {
      const applied = new Promise<void>((resolve) =>
        setTimeout(() => {
          apply();
          resolve();
        }, ACTION_DELAY_MS),
      );
      pending.add(applied);
      void applied.then(() => pending.delete(applied));
    },
    async settled() {
      await Promise.all(pending);
    },
  };
}
