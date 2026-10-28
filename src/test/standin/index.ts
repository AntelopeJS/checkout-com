import { Routes } from "./routes";
import { SimState } from "./state";
import { PayHostedPage } from "./hosted";
import { CompleteChallenge } from "./payments";
import { NewContext, type SimContext } from "./context";
import { type Fault, type RecordedCall, StandInServer } from "./server";

const ID_BODY = `standin${"0".repeat(19)}`;

export const STAND_IN_SECRET_KEY = `sk_sbox_${ID_BODY}`;
export const STAND_IN_PUBLIC_KEY = `pk_sbox_${ID_BODY}`;
export const STAND_IN_PROCESSING_CHANNEL = `pc_${ID_BODY}`;

const REGISTRY = Symbol.for("antelopejs.checkout-com.stand-in");

/**
 * A running stand-in, as tests see it: where it listens, what it was asked,
 * and the few things a payer or an outage would otherwise do.
 */
export class StandIn {
  private readonly server: StandInServer;
  private context: SimContext | undefined;

  constructor() {
    this.server = new StandInServer(
      { secretKey: STAND_IN_SECRET_KEY, publicKey: STAND_IN_PUBLIC_KEY },
      [],
    );
  }

  get calls(): RecordedCall[] {
    return this.server.calls;
  }

  async start(): Promise<string> {
    const baseUrl = await this.server.start();
    this.context = NewContext(new SimState(), baseUrl);
    this.server.useRoutes(Routes(this.context));
    return baseUrl;
  }

  stop(): Promise<void> {
    return this.server.stop();
  }

  injectFault(fault: Fault, times = 1): void {
    this.server.injectFault(fault, times);
  }

  clearFaults(): void {
    this.server.clearFaults();
  }

  /** Waits until every capture, void and refund accepted so far is applied. */
  settled(): Promise<void> {
    return this.sim().settled();
  }

  completeChallenge(paymentId: string, isAuthenticated: boolean): void {
    CompleteChallenge(this.sim(), paymentId, isAuthenticated);
  }

  payHostedPage(sessionId: string, cardNumber: string): string {
    return PayHostedPage(this.sim(), sessionId, cardNumber);
  }

  private sim(): SimContext {
    if (!this.context) throw new Error("The stand-in is not running");
    return this.context;
  }
}

type Registry = Record<symbol, StandIn | undefined>;

export function RegisterStandIn(standIn: StandIn | undefined): void {
  const registry: Registry = globalThis;
  registry[REGISTRY] = standIn;
}

/** The stand-in the suite runs against, or undefined when it runs live. */
export function CurrentStandIn(): StandIn | undefined {
  const registry: Registry = globalThis;
  return registry[REGISTRY];
}
