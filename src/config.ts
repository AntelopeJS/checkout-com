import { CkoClient } from "./implementations/payment/http";
import type { Account } from "./implementations/payment/accounts";

/** How a saved method's later off-session charges are declared to the schemes. */
export type MerchantInitiatedType = "Recurring" | "Unscheduled";

export interface AccountConfig {
  /** Secret API key: `sk_sbox_…` for sandbox, `sk_…` for production. */
  secretKey: string;
  /** The processing channel every payment is made on, `pc_…`. */
  processingChannelId: string;
  /**
   * The merchant-specific base URL from the Dashboard
   * (`https://{prefix}.api.sandbox.checkout.com`). Defaults to the shared host
   * for the key's environment.
   */
  baseUrl?: string;
  /** The signature key of the workflow's webhook action. */
  webhookSignatureKey?: string;
  /**
   * The `Authorization` header value given to the workflow's webhook action,
   * if one was. Deliveries without it are then refused.
   */
  webhookAuthorization?: string;
  /**
   * How a saved method's off-session charges are declared: `Recurring` for a
   * schedule (subscriptions), `Unscheduled` for charges at varying times.
   * Default `Recurring`.
   */
  merchantInitiatedType?: MerchantInitiatedType;
  /**
   * ISO 3166 alpha-2 country sent as the billing country of every hosted
   * payment page, which Checkout.com requires and a checkout session request
   * does not carry. Hosted checkout is refused without it.
   */
  checkoutBillingCountry?: string;
}

export interface Config extends AccountConfig {
  /**
   * Additional Checkout.com accounts, keyed by the name callers pass as the
   * payment interface's trailing `provider` selector. The top-level fields are
   * the default account, used when no selector is given.
   */
  accounts?: Record<string, AccountConfig>;
  /** How long one HTTP call may take. Default 30 seconds. */
  timeoutMs?: number;
  /**
   * How long a capture or a void is followed until Checkout.com reports it
   * applied. A refund is not followed. Default 10 seconds.
   */
  settleTimeoutMs?: number;
}

const SANDBOX_KEY_PREFIX = "sk_sbox_";
const SANDBOX_BASE_URL = "https://api.sandbox.checkout.com";
const PRODUCTION_BASE_URL = "https://api.checkout.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;

export function DefaultBaseUrl(secretKey: string): string {
  return secretKey.startsWith(SANDBOX_KEY_PREFIX)
    ? SANDBOX_BASE_URL
    : PRODUCTION_BASE_URL;
}

export function ToAccount(account: AccountConfig, config: Config): Account {
  return {
    client: new CkoClient({
      baseUrl: account.baseUrl || DefaultBaseUrl(account.secretKey),
      secretKey: account.secretKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
    processingChannelId: account.processingChannelId,
    webhookSignatureKey: account.webhookSignatureKey ?? "",
    webhookAuthorization: account.webhookAuthorization || undefined,
    merchantInitiatedType: account.merchantInitiatedType ?? "Recurring",
    checkoutBillingCountry: account.checkoutBillingCountry || undefined,
    settleTimeoutMs: config.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS,
  };
}
