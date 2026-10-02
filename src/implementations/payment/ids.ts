import {
  CustomerNotFoundError,
  PaymentNotFoundError,
} from "@antelopejs/interface-payment";

const PAYMENT_ID = /^(pay|sid)_\w{26}$/;
const CUSTOMER_ID = /^cus_\w{26}$/;
const INSTRUMENT_ID = /^src_\w{26}$/;
const ACTION_ID = /^act_\w{26}$/;
const HOSTED_PAYMENT_ID = /^hpp_[A-Za-z0-9_-]{12}$/;
const REFUND_SEPARATOR = ":";

export interface RefundId {
  payment: string;
  action: string;
}

/**
 * Checkout.com keeps a refund as an action on its payment, readable only
 * through that payment. The refund identifier this module hands out therefore
 * carries both halves.
 */
export function ToRefundId(payment: string, action: string): string {
  return `${payment}${REFUND_SEPARATOR}${action}`;
}

export function ParseRefundId(id: string): RefundId {
  const [payment = "", action = "", ...rest] = id.split(REFUND_SEPARATOR);
  if (rest.length > 0 || !PAYMENT_ID.test(payment) || !ACTION_ID.test(action)) {
    throw new PaymentNotFoundError(id, "refund");
  }
  return { payment, action };
}

/**
 * An identifier that cannot be one of Checkout.com's is reported as absent
 * without asking: the contract folds unparseable identifiers into not-found,
 * and the API's own answer to a malformed one (404 or 422) is not documented.
 */
export function AssertPaymentId(id: string): void {
  if (!PAYMENT_ID.test(id)) throw new PaymentNotFoundError(id, "payment");
}

export function AssertHostedPaymentId(id: string): void {
  if (!HOSTED_PAYMENT_ID.test(id)) {
    throw new PaymentNotFoundError(id, "checkout session");
  }
}

export function AssertCustomerId(id: string): void {
  if (!CUSTOMER_ID.test(id)) throw new CustomerNotFoundError(id, "customer");
}

export function AssertInstrumentId(id: string): void {
  if (!INSTRUMENT_ID.test(id)) {
    throw new CustomerNotFoundError(id, "payment method");
  }
}

export function IsPaymentId(value: unknown): value is string {
  return typeof value === "string" && PAYMENT_ID.test(value);
}
