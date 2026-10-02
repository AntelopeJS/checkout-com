import type { SimState } from "./state";
import type { CardBehaviour } from "./cards";
import type { StandInReply } from "./server";

const UNPROCESSABLE = 422;
const ACTION_DELAY_MS = 60;
const THREE_DECIMAL = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);
const WHOLE_HUNDREDS = new Set(["CLP"]);

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

/**
 * The amount rules of "Format the amount value": three-decimal currencies must
 * end in 0, CLP in 00.
 */
export function ToCurrencyRule(currency: unknown, amount: unknown): void {
  if (typeof currency !== "string" || currency.length !== 3) {
    throw new SimError(Problem("currency_required"));
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    throw new SimError(Problem("amount_invalid"));
  }
  const code = currency.toUpperCase();
  if (THREE_DECIMAL.has(code) && amount % 10 !== 0) {
    throw new SimError(Problem("amount_invalid"));
  }
  if (WHOLE_HUNDREDS.has(code) && amount % 100 !== 0) {
    throw new SimError(Problem("amount_invalid"));
  }
}

export function NewContext(state: SimState, baseUrl: string): SimContext {
  const pending = new Set<Promise<void>>();
  return {
    state,
    baseUrl,
    events: [],
    challenges: new Map(),
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
