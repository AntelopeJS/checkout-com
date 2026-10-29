import type {
  CreateSubscription,
  GetSubscription,
} from "@antelopejs/interface-subscriptions";

const PROBE = Symbol.for("antelopejs.checkout-com.renewal-probe");

export interface SubscriptionsProbe {
  CreateSubscription: typeof CreateSubscription;
  GetSubscription: typeof GetSubscription;
}

type Registry = Record<symbol, SubscriptionsProbe | undefined>;

/** interface-subscriptions, called from the probe module's own context. */
export function Subscriptions(): SubscriptionsProbe {
  const registry: Registry = globalThis;
  const probe = registry[PROBE];
  if (!probe) throw new Error("The renewal probe module is not running");
  return probe;
}
