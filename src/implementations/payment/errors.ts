import {
  CustomerNotFoundError,
  type CustomerEntity,
  InvalidPaymentStateError,
  type PaymentEntity,
  PaymentError,
  PaymentNotFoundError,
} from "@antelopejs/interface-payment";

import { CkoApiError, CkoTransportError } from "./http";

const NOT_FOUND = 404;
const FORBIDDEN = 403;
const UNPROCESSABLE = 422;
const BASE_URL_INVALID = "base_url_invalid";

/**
 * 422 codes meaning the amount or the payment's balance rules out the action.
 * Checkout.com documents no refund-specific code, so an over-refund is expected
 * under the balance code.
 */
const STATE_CODES = new Set([
  "amount_exceeds_balance",
  "capture_value_greater_than_authorized",
  "capture_value_greater_than_remaining_authorized",
  "void_amount_invalid",
]);

const CUSTOMER_CODES = new Set(["customer_id_invalid", "customer_not_found"]);
const METHOD_CODES = new Set([
  "source_id_invalid",
  "source_id_unknown",
  "instrument_not_found",
]);

export interface ErrorContext {
  /** What a 404 refers to for the call being made. */
  entity: PaymentEntity | CustomerEntity;
  /**
   * Whether a 403 means the payment's state rules the action out. The capture,
   * void and refund endpoints answer "not allowed" with a bodiless 403.
   */
  forbiddenIsState?: boolean;
  /** The customer a 422 customer code refers to, when not `id`. */
  customer?: string;
  /** The payment method a 422 source code refers to, when not `id`. */
  method?: string;
}

const CUSTOMER_ENTITIES = new Set<ErrorContext["entity"]>([
  "customer",
  "payment method",
]);

function isCustomerEntity(
  entity: ErrorContext["entity"],
): entity is CustomerEntity {
  return CUSTOMER_ENTITIES.has(entity);
}

function notFound(
  id: string,
  entity: ErrorContext["entity"],
  code?: string,
): PaymentError {
  if (isCustomerEntity(entity)) {
    return new CustomerNotFoundError(id, entity, code);
  }
  return new PaymentNotFoundError(id, entity, code);
}

function fromUnprocessable(
  error: CkoApiError,
  id: string,
  context: ErrorContext,
): PaymentError {
  const [code] = error.errorCodes;
  if (error.errorCodes.some((each) => STATE_CODES.has(each))) {
    return new InvalidPaymentStateError(error.message, undefined, code);
  }
  if (error.errorCodes.some((each) => CUSTOMER_CODES.has(each))) {
    return new CustomerNotFoundError(context.customer ?? id, "customer", code);
  }
  if (error.errorCodes.some((each) => METHOD_CODES.has(each))) {
    return new CustomerNotFoundError(
      context.method ?? id,
      "payment method",
      code,
    );
  }
  return new PaymentError(error.message, code ?? error.errorType);
}

function fromForbidden(
  error: CkoApiError,
  context: ErrorContext,
): PaymentError {
  if (error.errorType === BASE_URL_INVALID) {
    return new PaymentError(
      "Checkout.com refused the base URL: set the account's baseUrl to the merchant-specific URL from the Dashboard (https://{prefix}.api.checkout.com)",
      BASE_URL_INVALID,
    );
  }
  if (context.forbiddenIsState) {
    return new InvalidPaymentStateError(
      "Checkout.com does not allow this action on the payment in its current state",
      undefined,
      error.errorType ?? String(FORBIDDEN),
    );
  }
  return new PaymentError(error.message, error.errorType ?? String(FORBIDDEN));
}

/**
 * Translates a failed Checkout.com call into the interface's error vocabulary.
 *
 * Only an answer Checkout.com actually gave can become a not-found or a state
 * error. A call that never got an answer, a 401, a 409, a 429 or a 5xx stays a
 * plain {@link PaymentError}: each is retryable, and reporting one as "this
 * payment cannot be refunded" turns an outage into a permanent refusal.
 *
 * @param cause - The thrown value, which may not be a Checkout.com error at all
 * @param id - The identifier the call was made against, for the message
 * @param context - What a 404 and a 403 mean for this call
 * @returns The translated error, or `cause` itself when Checkout.com did not raise it
 */
export function TranslateError<Cause>(
  cause: Cause,
  id: string,
  context: ErrorContext,
): Cause | PaymentError {
  if (cause instanceof CkoTransportError) {
    return new PaymentError(cause.message, "unreachable");
  }
  if (!(cause instanceof CkoApiError)) {
    return cause;
  }
  if (cause.status === NOT_FOUND) {
    return notFound(id, context.entity, String(NOT_FOUND));
  }
  if (cause.status === FORBIDDEN) {
    return fromForbidden(cause, context);
  }
  if (cause.status === UNPROCESSABLE) {
    return fromUnprocessable(cause, id, context);
  }
  return new PaymentError(
    cause.message,
    cause.errorCodes[0] ?? cause.errorType ?? String(cause.status),
  );
}

/**
 * Runs a Checkout.com call, translating any error it raises.
 */
export async function Translating<T>(
  id: string,
  context: ErrorContext,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw TranslateError(error, id, context);
  }
}
