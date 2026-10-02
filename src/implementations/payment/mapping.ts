import { PaymentError } from "@antelopejs/interface-payment";
import type {
  Amount,
  CardDetails,
  Dispute,
  Payment,
  PaymentFailure,
  PaymentFailureCode,
  PaymentMethod,
  PaymentMethodType,
  PaymentStatus,
  Refund,
  RefundStatus,
} from "@antelopejs/interface-payment";

import { ToRefundId } from "./ids";
import type {
  CkoAction,
  CkoDisputeEventData,
  CkoInstrument,
  CkoMetadata,
  CkoPayment,
} from "./cko-types";

/**
 * Metadata key recording whether this module asked for capture. Checkout.com
 * reports `Authorized` both for a hold awaiting {@link CapturePayment} and for
 * an automatic capture it has not processed yet; only the first is
 * `authorized` in the contract.
 */
export const CAPTURE_KEY = "antelope_capture";
export const MANUAL_CAPTURE = "manual";
export const AUTOMATIC_CAPTURE = "auto";

/** Metadata key naming the customer a hosted session saves the method for. */
export const SAVE_FOR_KEY = "antelope_save_for";

/** Checkout.com's refund request has no reason field; it is kept here. */
export const REFUND_REASON_KEY = "antelope_refund_reason";

const INTERNAL_KEYS = new Set([CAPTURE_KEY, SAVE_FOR_KEY, REFUND_REASON_KEY]);

const STATUS_BY_CKO: Record<string, PaymentStatus> = {
  Authorized: "authorized",
  Canceled: "canceled",
  Captured: "succeeded",
  "Card Verified": "succeeded",
  Declined: "failed",
  Expired: "canceled",
  Paid: "succeeded",
  "Partially Captured": "succeeded",
  "Partially Refunded": "succeeded",
  Pending: "pending",
  Refunded: "succeeded",
  "Retry Scheduled": "pending",
  Voided: "canceled",
};

const FAILURE_BY_RESPONSE_CODE: Record<string, PaymentFailureCode> = {
  "20014": "incorrect_details",
  "20051": "insufficient_funds",
  "20054": "expired_card",
  "20068": "processing_error",
  "20087": "incorrect_details",
  "20091": "processing_error",
  "20096": "processing_error",
  "20100": "incorrect_details",
  "20124": "incorrect_details",
  "20150": "authentication_failed",
  "20151": "authentication_failed",
  "20152": "expired",
  "20153": "processing_error",
  "20154": "authentication_failed",
  "20155": "authentication_failed",
  "20159": "processing_error",
  "200N7": "incorrect_details",
  "30033": "expired_card",
  "43401": "authentication_failed",
  "50280": "insufficient_funds",
};

const METHOD_TYPE_BY_CKO: Record<string, PaymentMethodType> = {
  ach: "bank_account",
  bank_account: "bank_account",
  card: "card",
  sepa: "bank_account",
};

export interface PaymentContext {
  /** The amount asked for, for the 202 answer that does not repeat it. */
  requested?: Amount;
  /** Why a declined payment failed, when the payment body does not say. */
  failure?: PaymentFailure;
}

export function ToEpochMillis(timestamp: string | undefined): number {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toAmount(value: number | undefined, currency: string): Amount {
  return { value: value ?? 0, currency: currency.toUpperCase() };
}

/**
 * Splits the caller's metadata from the keys this module keeps in it.
 * Checkout.com accepts numbers and booleans as values; the contract's metadata
 * is strings, so every value is read back as one.
 */
function ReadMetadata(
  metadata: CkoMetadata | undefined,
): Record<string, string> {
  const own = Object.entries(metadata ?? {}).filter(
    ([key]) => !INTERNAL_KEYS.has(key),
  );
  return Object.fromEntries(own.map(([key, value]) => [key, String(value)]));
}

export function WriteMetadata(
  metadata: Record<string, string> | undefined,
  internal: Record<string, string>,
): CkoMetadata {
  return { ...metadata, ...internal };
}

/**
 * Checkout.com says `Pending` both for a payment waiting on the payer and for
 * one simply in flight; the redirect link is the discriminator, and it is only
 * present on the answer to the call that created the payment.
 */
export function ToPaymentStatus(payment: CkoPayment): PaymentStatus {
  const status = STATUS_BY_CKO[payment.status] ?? "pending";
  if (status === "pending" && payment._links?.redirect?.href) {
    return "requires_action";
  }
  if (
    status === "authorized" &&
    payment.metadata?.[CAPTURE_KEY] === AUTOMATIC_CAPTURE
  ) {
    return "pending";
  }
  return status;
}

export function ToFailure(
  responseCode: string | number | undefined,
  summary: string | undefined,
): PaymentFailure {
  const code = responseCode === undefined ? undefined : String(responseCode);
  return {
    code: FAILURE_BY_RESPONSE_CODE[code ?? ""] ?? "declined",
    message: summary || "The payment was declined",
    ...(code ? { providerCode: code } : {}),
  };
}

function redirectUrl(payment: CkoPayment): string {
  const url = payment._links?.redirect?.href;
  if (!url) {
    throw new PaymentError(
      `Payment ${payment.id} needs payer action but Checkout.com gave no redirect link`,
    );
  }
  return url;
}

function failureOf(
  payment: CkoPayment,
  context: PaymentContext,
): PaymentFailure {
  return (
    context.failure ??
    ToFailure(payment.response_code, payment.response_summary)
  );
}

/**
 * Normalises any of the three payment shapes Checkout.com answers with.
 */
export function ToPayment(
  payment: CkoPayment,
  context: PaymentContext = {},
): Payment {
  const status = ToPaymentStatus(payment);
  const currency = payment.currency ?? context.requested?.currency ?? "";
  const metadata = ReadMetadata(payment.metadata);
  return {
    id: payment.id,
    amount: toAmount(payment.amount ?? context.requested?.value, currency),
    amountCaptured: toAmount(payment.balances?.total_captured, currency),
    amountRefunded: toAmount(payment.balances?.total_refunded, currency),
    status,
    reference: payment.reference ?? "",
    createdAt: ToEpochMillis(payment.requested_on ?? payment.processed_on),
    ...(payment.customer?.id ? { customer: payment.customer.id } : {}),
    ...(payment.source?.id ? { paymentMethod: payment.source.id } : {}),
    ...(status === "requires_action"
      ? { redirectUrl: redirectUrl(payment) }
      : {}),
    ...(status === "failed" ? { failure: failureOf(payment, context) } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

/**
 * `approved` is optional on a payment action. A refund action without it has
 * been accepted but not yet processed.
 */
function refundStatus(action: CkoAction | undefined): RefundStatus {
  if (action?.approved === undefined) return "pending";
  return action.approved ? "succeeded" : "failed";
}

export function ToRefund(
  payment: CkoPayment,
  action: CkoAction | undefined,
  refundAction: string,
  requested?: Amount,
): Refund {
  const currency = payment.currency ?? requested?.currency ?? "";
  const status = refundStatus(action);
  const metadata = ReadMetadata(action?.metadata);
  return {
    id: ToRefundId(payment.id, refundAction),
    payment: payment.id,
    amount: toAmount(action?.amount ?? requested?.value, currency),
    status,
    createdAt: ToEpochMillis(action?.processed_on),
    ...(status === "failed"
      ? {
          failure: {
            ...ToFailure(action?.response_code, action?.response_summary),
            code: "processing_error" as PaymentFailureCode,
          },
        }
      : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function toCard(instrument: CkoInstrument): CardDetails | undefined {
  if (instrument.type !== "card") {
    return undefined;
  }
  return {
    brand: instrument.scheme ?? "unknown",
    last4: String(instrument.last4 ?? "").padStart(4, "0"),
    expiryMonth: instrument.expiry_month ?? 0,
    expiryYear: instrument.expiry_year ?? 0,
  };
}

export function ToPaymentMethod(
  instrument: CkoInstrument,
  customer: string,
  savedAt: number,
): PaymentMethod {
  const card = toCard(instrument);
  return {
    id: instrument.id,
    type: METHOD_TYPE_BY_CKO[instrument.type] ?? "other",
    customer,
    createdAt: savedAt,
    ...(card ? { card } : {}),
  };
}

export function ToDispute(
  dispute: CkoDisputeEventData,
  fallbackTime: string | undefined,
): Dispute {
  return {
    id: dispute.id,
    payment: dispute.payment_id ?? "",
    amount: toAmount(dispute.amount, dispute.currency ?? ""),
    createdAt: ToEpochMillis(dispute.date ?? fallbackTime),
    ...(dispute.category ? { reason: dispute.category } : {}),
  };
}
