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
import { LookUp } from "./lookup";
import { IsText } from "./guards";
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
const MANUAL_CAPTURE = "manual";
export const AUTOMATIC_CAPTURE = "auto";

/** Metadata key naming the customer a saving payment or hosted session saves the method for. */
export const SAVE_FOR_KEY = "antelope_save_for";

/** Checkout.com's refund request has no reason field; it is kept here. */
export const REFUND_REASON_KEY = "antelope_refund_reason";

/** The entries this module keeps in a payment's metadata, next to the caller's. */
export type InternalMetadata = {
  [CAPTURE_KEY]?: string;
  [SAVE_FOR_KEY]?: string;
  [REFUND_REASON_KEY]?: string;
};

const INTERNAL_KEYS = new Set([CAPTURE_KEY, SAVE_FOR_KEY, REFUND_REASON_KEY]);

/** What a payment or hosted session request asks of capture and saving. */
interface InternalIntent {
  authorizeOnly?: boolean;
  savePaymentMethod?: boolean;
  customer?: string;
}

/** The entries this module adds to a payment's metadata for `request`. */
export function InternalMetadataOf(request: InternalIntent): InternalMetadata {
  const internal: InternalMetadata = {
    [CAPTURE_KEY]: request.authorizeOnly ? MANUAL_CAPTURE : AUTOMATIC_CAPTURE,
  };
  if (request.savePaymentMethod && request.customer) {
    internal[SAVE_FOR_KEY] = request.customer;
  }
  return internal;
}

const STATUS_BY_CKO = {
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
} satisfies Record<string, PaymentStatus>;

const FAILURE_BY_RESPONSE_CODE = {
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
} satisfies Record<string, PaymentFailureCode>;

const METHOD_TYPE_BY_CKO = {
  ach: "bank_account",
  bank_account: "bank_account",
  card: "card",
  sepa: "bank_account",
} satisfies Record<string, PaymentMethodType>;

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

/**
 * The metadata sent with a payment: the caller's, without any key this module
 * owns, so a caller's value is never read back as one of the module's
 * markers, and then the module's own entries.
 */
export function WriteMetadata(
  metadata: Record<string, string> | undefined,
  internal: Record<string, string>,
): CkoMetadata {
  const own = Object.entries(metadata ?? {}).filter(
    ([key]) => !INTERNAL_KEYS.has(key),
  );
  return { ...Object.fromEntries(own), ...internal };
}

/**
 * Checkout.com says `Pending` both for a payment waiting on the payer and for
 * one simply in flight; the redirect link, present on the creating answer and
 * on reads until the payer is past 3DS, is the discriminator.
 */
export function ToPaymentStatus(payment: CkoPayment): PaymentStatus {
  const status = LookUp(STATUS_BY_CKO, payment.status) ?? "pending";
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
  const failure: PaymentFailure = {
    code: LookUp(FAILURE_BY_RESPONSE_CODE, code ?? "") ?? "declined",
    message: summary || "The payment was declined",
  };
  if (code) {
    failure.providerCode = code;
  }
  return failure;
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
 * A saving payment is sent without its customer, so the card is linked only
 * once the payer has authenticated; its customer is the one its
 * `antelope_save_for` marker names, even when Checkout.com reports the owner
 * of a card it was given.
 */
function customerOf(payment: CkoPayment): string | undefined {
  const marked = payment.metadata?.[SAVE_FOR_KEY];
  return IsText(marked) ? marked : payment.customer?.id;
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
  const normalised: Payment = {
    id: payment.id,
    amount: toAmount(payment.amount ?? context.requested?.value, currency),
    amountCaptured: toAmount(payment.balances?.total_captured, currency),
    amountRefunded: toAmount(payment.balances?.total_refunded, currency),
    status,
    reference: payment.reference ?? "",
    createdAt: ToEpochMillis(payment.requested_on ?? payment.processed_on),
  };
  const customer = customerOf(payment);
  if (customer) {
    normalised.customer = customer;
  }
  if (payment.source?.id) {
    normalised.paymentMethod = payment.source.id;
  }
  if (status === "requires_action") {
    normalised.redirectUrl = redirectUrl(payment);
  }
  if (status === "failed") {
    normalised.failure = failureOf(payment, context);
  }
  if (Object.keys(metadata).length > 0) {
    normalised.metadata = metadata;
  }
  return normalised;
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
  const refund: Refund = {
    id: ToRefundId(payment.id, refundAction),
    payment: payment.id,
    amount: toAmount(action?.amount ?? requested?.value, currency),
    status,
    createdAt: ToEpochMillis(action?.processed_on),
  };
  if (status === "failed") {
    refund.failure = {
      ...ToFailure(action?.response_code, action?.response_summary),
      code: "processing_error",
    };
  }
  if (Object.keys(metadata).length > 0) {
    refund.metadata = metadata;
  }
  return refund;
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
  const method: PaymentMethod = {
    id: instrument.id,
    type: LookUp(METHOD_TYPE_BY_CKO, instrument.type) ?? "other",
    customer,
    createdAt: savedAt,
  };
  if (card) {
    method.card = card;
  }
  return method;
}

export function ToDispute(
  dispute: CkoDisputeEventData,
  fallbackTime: string | undefined,
): Dispute {
  const opened: Dispute = {
    id: dispute.id,
    payment: dispute.payment_id ?? "",
    amount: toAmount(dispute.amount, dispute.currency ?? ""),
    createdAt: ToEpochMillis(dispute.date ?? fallbackTime),
  };
  if (dispute.category) {
    opened.reason = dispute.category;
  }
  return opened;
}
