import { PaymentError } from "@antelopejs/interface-payment";

import { CkoClient } from "./http";

export interface Account {
  client: CkoClient;
  processingChannelId: string;
  webhookSignatureKey: string;
  webhookAuthorization: string | undefined;
  merchantInitiatedType: "Recurring" | "Unscheduled";
  checkoutBillingCountry: string | undefined;
  settleTimeoutMs: number;
}

const accounts = new Map<string, Account>();
const DEFAULT_ACCOUNT = "";

export function RegisterAccount(
  name: string | undefined,
  account: Account,
): void {
  accounts.set(name ?? DEFAULT_ACCOUNT, account);
}

export function ClearAccounts(): void {
  accounts.clear();
}

/**
 * Resolves the configured account a call should use.
 *
 * @param provider - Account name from the interface's trailing selector
 * @throws PaymentError if the module was not configured with that account
 */
export function GetAccount(provider?: string): Account {
  const account = accounts.get(provider ?? DEFAULT_ACCOUNT);
  if (!account) {
    throw new PaymentError(
      provider
        ? `No Checkout.com account configured under "${provider}"`
        : "The Checkout.com module has no default account configured",
    );
  }
  return account;
}
