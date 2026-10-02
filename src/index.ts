import * as payment from "@antelopejs/interface-payment";
import { ImplementInterface } from "@antelopejs/interface-core";

import { type Config, ToAccount } from "./config";
import {
  ClearAccounts,
  RegisterAccount,
} from "./implementations/payment/accounts";

export type { AccountConfig, Config, MerchantInitiatedType } from "./config";

function registerAccounts(config: Config): void {
  RegisterAccount(undefined, ToAccount(config, config));
  for (const [name, account] of Object.entries(config.accounts ?? {})) {
    RegisterAccount(name, ToAccount(account, config));
  }
}

export async function construct(config: Config): Promise<void> {
  registerAccounts(config);
  ImplementInterface(payment, await import("./implementations/payment"));
}

export function destroy(): void {
  ClearAccounts();
}
