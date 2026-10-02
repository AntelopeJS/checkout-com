import { PaymentError } from "@antelopejs/interface-payment";
import type {
  CheckoutSession,
  CheckoutSessionRequest,
  PaymentStatus,
} from "@antelopejs/interface-payment";

import { Translating } from "./errors";
import { LoadPayment } from "./follow";
import { SessionOnce } from "./session-replays";
import { RememberHostedSave } from "./saved-methods";
import { type Account, GetAccount } from "./accounts";
import { AssertCustomerId, AssertHostedPaymentId, IsPaymentId } from "./ids";
import type {
  CkoCustomer,
  CkoHostedPayment,
  CkoHostedPaymentCreated,
} from "./cko-types";
import {
  AUTOMATIC_CAPTURE,
  CAPTURE_KEY,
  MANUAL_CAPTURE,
  SAVE_FOR_KEY,
  ToEpochMillis,
  WriteMetadata,
} from "./mapping";

const SESSION_ENTITY = { entity: "checkout session" as const };
const CUSTOMER_ENTITY = { entity: "customer" as const };
const RECEIVED = "Payment Received";
const MANDATE_CHALLENGE = "challenge_requested_mandate";

const STATUS_BY_HOSTED: Record<string, PaymentStatus> = {
  Expired: "canceled",
  "Payment Pending": "pending",
};

const HOSTED_LOCALES = [
  "ar",
  "da-DK",
  "de-DE",
  "el",
  "en-GB",
  "es-ES",
  "fi-FI",
  "fil-PH",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ms-MY",
  "nb-NO",
  "nl-NL",
  "pt-PT",
  "sv-SE",
  "th-TH",
  "vi-VN",
  "zh-CN",
  "zh-HK",
  "zh-TW",
];

const LOCALE_BY_TAG: Record<string, string> = Object.fromEntries([
  ...HOSTED_LOCALES.map((locale) => [locale.split("-")[0], locale]).reverse(),
  ...HOSTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
]);

function hostedLocale(locale: string | undefined): Record<string, string> {
  if (!locale) return {};
  const lowered = locale.toLowerCase();
  const match = LOCALE_BY_TAG[lowered] ?? LOCALE_BY_TAG[lowered.split("-")[0]];
  return match ? { locale: match } : {};
}

function billingCountry(account: Account): string {
  if (!account.checkoutBillingCountry) {
    throw new PaymentError(
      "Checkout.com's hosted page requires a billing country, which a checkout session request does not carry: set checkoutBillingCountry on the account",
    );
  }
  return account.checkoutBillingCountry;
}

async function hostedCustomer(
  account: Account,
  customer: string | undefined,
): Promise<Record<string, unknown>> {
  if (!customer) return {};
  AssertCustomerId(customer);
  const { body } = await Translating(customer, CUSTOMER_ENTITY, () =>
    account.client.send<CkoCustomer>({
      method: "GET",
      path: `/customers/${customer}`,
    }),
  );
  return {
    customer: { email: body.email, ...(body.name ? { name: body.name } : {}) },
  };
}

function saving(
  account: Account,
  request: CheckoutSessionRequest,
): Record<string, unknown> {
  if (!request.savePaymentMethod) return {};
  return {
    payment_type:
      account.merchantInitiatedType === "Recurring" ? "Recurring" : "Regular",
    payment_method_configuration: {
      card: { store_payment_details: "enabled" },
    },
    "3ds": { enabled: true, challenge_indicator: MANDATE_CHALLENGE },
  };
}

async function buildRequest(
  account: Account,
  request: CheckoutSessionRequest,
): Promise<Record<string, unknown>> {
  return {
    amount: request.amount.value,
    currency: request.amount.currency.toUpperCase(),
    reference: request.reference,
    billing: { address: { country: billingCountry(account) } },
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    failure_url: request.cancelUrl,
    capture: !request.authorizeOnly,
    processing_channel_id: account.processingChannelId,
    metadata: WriteMetadata(request.metadata, {
      [CAPTURE_KEY]: request.authorizeOnly ? MANUAL_CAPTURE : AUTOMATIC_CAPTURE,
      ...(request.savePaymentMethod && request.customer
        ? { [SAVE_FOR_KEY]: request.customer }
        : {}),
    }),
    ...(request.description ? { description: request.description } : {}),
    ...hostedLocale(request.locale),
    ...(await hostedCustomer(account, request.customer)),
    ...saving(account, request),
  };
}

/**
 * `/hosted-payments` takes no idempotency key and a session can be found again
 * only by its id, so a replayed key is recognised within this process only. A
 * retry after a restart, or on another instance, opens a second page.
 */
export async function CreateCheckoutSession(
  request: CheckoutSessionRequest,
  idempotencyKey: string,
  provider?: string,
): Promise<CheckoutSession> {
  if (request.savePaymentMethod && !request.customer) {
    throw new PaymentError("savePaymentMethod requires a customer");
  }
  const account = GetAccount(provider);
  return SessionOnce(provider, idempotencyKey, () =>
    Translating("", SESSION_ENTITY, async () => {
      const { body } = await account.client.send<CkoHostedPaymentCreated>({
        method: "POST",
        path: "/hosted-payments",
        body: await buildRequest(account, request),
      });
      return {
        id: body.id,
        redirectUrl: body._links.redirect?.href ?? "",
        status: "pending" as const,
      };
    }),
  );
}

/**
 * While the page is open the payer can still retry, so its own status wins
 * even when a failed attempt has already produced a payment. Once a payment is
 * received, the payment is the better answer: it tells `authorized` from
 * `succeeded`.
 */
async function sessionStatus(
  account: Account,
  hosted: CkoHostedPayment,
): Promise<PaymentStatus> {
  if (hosted.status !== RECEIVED || !IsPaymentId(hosted.payment_id)) {
    return STATUS_BY_HOSTED[hosted.status] ?? "pending";
  }
  const payment = await LoadPayment(account.client, hosted.payment_id);
  await RememberHostedSave(
    account.client,
    hosted.metadata?.[SAVE_FOR_KEY],
    payment,
  );
  return payment.status;
}

export async function GetCheckoutSession(
  id: string,
  provider?: string,
): Promise<CheckoutSession> {
  AssertHostedPaymentId(id);
  const account = GetAccount(provider);
  return Translating(id, SESSION_ENTITY, async () => {
    const { body } = await account.client.send<CkoHostedPayment>({
      method: "GET",
      path: `/hosted-payments/${id}`,
    });
    return {
      id: body.id,
      redirectUrl: body._links.redirect?.href ?? "",
      status: await sessionStatus(account, body),
      ...(IsPaymentId(body.payment_id) ? { payment: body.payment_id } : {}),
      ...(body.expires_on ? { expiresAt: ToEpochMillis(body.expires_on) } : {}),
    };
  });
}
