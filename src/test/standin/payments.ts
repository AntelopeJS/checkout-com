import { ResolveSource } from "./vault";
import voidAcceptedFixture from "./fixtures/void-202.json";
import type { StandInReply, StandInRequest } from "./server";
import refundAcceptedFixture from "./fixtures/refund-202.json";
import { type CardBehaviour, CardOutcome, NotEnrolled } from "./cards";
import refundDeclinedFixture from "./fixtures/refund-422-declined.json";
import {
  type Amount,
  Problem,
  type SimContext,
  SimError,
  ParseAmount,
} from "./context";
import { type JsonObject, CountOf, MetadataOf, ObjectOf, TextOf } from "./wire";
import {
  PaymentAccepted,
  PaymentActions,
  PaymentDetails,
  PaymentResponse,
} from "./views";
import {
  EmptyBalances,
  NewId,
  type SimAction,
  type SimInstrument,
  type SimPayment,
} from "./state";

const APPROVED = "10000";
const ACCEPTED = 202;
const CREATED = 201;
const OK = 200;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const REGULAR = "Regular";
const FAILED_AUTHENTICATION: CardBehaviour = {
  responseCode: "20151",
  responseSummary: "Cardholder failed 3DS authentication",
  threeDs: "challenge",
};
const SELF_STORING_TYPES = new Set(["Recurring", "Installment", "Unscheduled"]);

function now(): string {
  return new Date().toISOString();
}

function action(type: string, amount: number, approved = true): SimAction {
  return {
    id: NewId("act"),
    type,
    amount,
    approved,
    responseCode: approved ? APPROVED : "20005",
    responseSummary: approved ? "Approved" : "Declined",
    processedOn: now(),
  };
}

function assertInitiation(context: SimContext, body: JsonObject): void {
  const paymentType = TextOf(body.payment_type) ?? REGULAR;
  if (body.merchant_initiated === true && paymentType === REGULAR) {
    throw new SimError(Problem("payment_type_invalid"));
  }
  const previous = TextOf(body.previous_payment_id);
  if (previous && !context.state.payments.has(previous)) {
    throw new SimError(Problem("previous_payment_id_invalid"));
  }
}

function isThreeDsRequested(body: JsonObject): boolean {
  const threeDs = ObjectOf(body["3ds"]);
  return threeDs?.enabled === true || threeDs?.enabled === "true";
}

/**
 * The sandbox answers every 3DS payment on an enrolled card with a redirect,
 * frictionless cards included (observed 2026-11-10): authentication runs in
 * the payer's browser either way.
 */
function needsRedirect(behaviour: CardBehaviour, body: JsonObject): boolean {
  if (behaviour.threeDs === "upgrade") return true;
  return behaviour.threeDs !== "not_enabled" && isThreeDsRequested(body);
}

function decide(behaviour: CardBehaviour, body: JsonObject): CardBehaviour {
  return behaviour.threeDs === "not_enabled" && isThreeDsRequested(body)
    ? NotEnrolled()
    : behaviour;
}

function newPayment(
  body: JsonObject,
  money: Amount,
  instrument: SimInstrument | undefined,
  customer: string | undefined,
): SimPayment {
  const payment: SimPayment = {
    id: NewId("pay"),
    amount: money.value,
    currency: money.currency,
    status: "Pending",
    approved: false,
    reference: TextOf(body.reference),
    description: TextOf(body.description),
    requestedOn: now(),
    instrument: instrument?.id,
    customer: customer ?? instrument?.customer,
    metadata: MetadataOf(body.metadata),
    paymentType: TextOf(body.payment_type) ?? REGULAR,
    isMerchantInitiated: body.merchant_initiated === true,
    previousPaymentId: TextOf(body.previous_payment_id),
    isAutoCapture: body.capture !== false,
    responseCode: "",
    responseSummary: "",
    balances: EmptyBalances(),
    actions: [],
  };
  return payment;
}

function capture(
  context: SimContext,
  payment: SimPayment,
  amount: number,
  actionId = NewId("act"),
) {
  const isCapturable =
    payment.status === "Authorized" &&
    amount <= payment.balances.available_to_capture;
  if (!isCapturable) return;
  const remainder = payment.balances.available_to_capture - amount;
  payment.balances.total_captured += amount;
  payment.balances.available_to_capture = 0;
  payment.balances.available_to_void = 0;
  payment.balances.total_voided += remainder;
  payment.balances.available_to_refund += amount;
  payment.status = remainder > 0 ? "Partially Captured" : "Captured";
  payment.actions.push({ ...action("Capture", amount), id: actionId });
  context.events.push({ type: "payment_captured", payment: payment.id });
}

function authorize(
  context: SimContext,
  payment: SimPayment,
  behaviour: CardBehaviour,
): void {
  const approved = behaviour.responseCode === APPROVED;
  payment.approved = approved;
  payment.status = approved ? "Authorized" : "Declined";
  payment.responseCode = behaviour.responseCode;
  payment.responseSummary = behaviour.responseSummary;
  payment.actions.push({
    ...action("Authorization", payment.amount, approved),
    responseCode: behaviour.responseCode,
    responseSummary: behaviour.responseSummary,
  });
  if (!approved) return;
  payment.balances.total_authorized = payment.amount;
  payment.balances.available_to_capture = payment.amount;
  payment.balances.available_to_void = payment.amount;
  if (payment.isAutoCapture) {
    context.later(() => capture(context, payment, payment.amount));
  }
}

/** A `POST /payments` that was accepted, and the answer it was given. */
export interface SubmittedPayment {
  payment: SimPayment;
  reply: StandInReply;
}

/** The payment a `POST /payments` body asks for: authorization, 3DS by test card, MIT validation. */
export function SubmitPayment(
  context: SimContext,
  body: JsonObject,
): SubmittedPayment {
  const money = ParseAmount(body.currency, body.amount);
  assertInitiation(context, body);
  const isStoring =
    SELF_STORING_TYPES.has(TextOf(body.payment_type) ?? "") &&
    body.merchant_initiated !== true;
  const source = ResolveSource(context, body, isStoring);
  const payment = newPayment(body, money, source.instrument, source.customer);
  context.state.payments.set(payment.id, payment);
  const behaviour = CardOutcome(source.card, payment.amount);
  if (needsRedirect(behaviour, body)) {
    payment.redirectUrl = `${context.baseUrl}/3ds/${payment.id}`;
    context.challenges.set(payment.id, { behaviour, commit: source.commit });
    source.commit(true);
    return {
      payment,
      reply: {
        status: ACCEPTED,
        body: PaymentAccepted(context.state, payment, context.baseUrl),
      },
    };
  }
  authorize(context, payment, decide(behaviour, body));
  source.commit(payment.approved);
  return {
    payment,
    reply: {
      status: CREATED,
      body: PaymentResponse(context.state, payment, context.baseUrl),
    },
  };
}

/** `POST /payments`. */
export function CreatePayment(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  return SubmitPayment(context, request.body).reply;
}

/** The payer completing (or failing) the 3DS challenge of a 202 payment. */
export function CompleteChallenge(
  context: SimContext,
  id: string,
  isAuthenticated: boolean,
): void {
  const payment = context.state.payments.get(id);
  const challenge = context.challenges.get(id);
  if (!payment || !challenge) throw new Error(`No challenge for ${id}`);
  context.challenges.delete(id);
  authorize(
    context,
    payment,
    isAuthenticated ? challenge.behaviour : FAILED_AUTHENTICATION,
  );
  payment.redirectUrl = undefined;
  challenge.commit(payment.approved);
}

/**
 * The payer's browser opening the redirect. A frictionless card authenticates
 * without the payer doing anything; a challenged one waits for their answer.
 */
export function VisitRedirect(context: SimContext, id: string): StandInReply {
  const challenge = context.challenges.get(id);
  if (challenge?.behaviour.threeDs === "frictionless") {
    CompleteChallenge(context, id, true);
  }
  return { status: OK };
}

function found(context: SimContext, id: string): SimPayment {
  const payment = context.state.payments.get(id);
  if (!payment) throw new SimError({ status: NOT_FOUND });
  return payment;
}

export function GetPayment(context: SimContext, id: string): StandInReply {
  return {
    status: OK,
    body: PaymentDetails(context.state, found(context, id), context.baseUrl),
  };
}

export function GetActions(context: SimContext, id: string): StandInReply {
  return { status: OK, body: PaymentActions(found(context, id)) };
}

function accepted(
  context: SimContext,
  payment: SimPayment,
  actionId: string,
  fixture: JsonObject,
): StandInReply {
  return {
    status: ACCEPTED,
    body: {
      ...structuredClone(fixture),
      action_id: actionId,
      reference: payment.reference,
      _links: {
        payment: { href: `${context.baseUrl}/payments/${payment.id}` },
      },
    },
  };
}

/**
 * `POST /payments/{id}/captures`: refused unless authorized, then async. The
 * sandbox refuses with 422 `no_balance_available_to_capture`, not the 403 the
 * documentation shows (observed 2026-11-10).
 */
export function Capture(
  context: SimContext,
  request: StandInRequest,
  id: string,
): StandInReply {
  const payment = found(context, id);
  if (payment.status !== "Authorized")
    throw new SimError(Problem("no_balance_available_to_capture"));
  const amount =
    CountOf(request.body.amount) ?? payment.balances.available_to_capture;
  if (amount > payment.balances.available_to_capture) {
    throw new SimError(Problem("capture_value_greater_than_authorized"));
  }
  const actionId = NewId("act");
  context.later(() => capture(context, payment, amount, actionId));
  return accepted(context, payment, actionId, voidAcceptedFixture);
}

/**
 * `POST /payments/{id}/voids`: refused unless authorized, then async. The
 * sandbox refuses a payment waiting for 3DS, captured or declined with 422
 * `no_balance_available_to_void` (observed 2026-11-10).
 */
export function Void(context: SimContext, id: string): StandInReply {
  const payment = found(context, id);
  if (payment.status !== "Authorized")
    throw new SimError(Problem("no_balance_available_to_void"));
  const voided = action("Void", payment.balances.available_to_void);
  context.later(() => {
    payment.balances.total_voided += payment.balances.available_to_void;
    payment.balances.available_to_void = 0;
    payment.balances.available_to_capture = 0;
    payment.status = "Voided";
    payment.actions.push(voided);
    context.events.push({ type: "payment_voided", payment: payment.id });
  });
  return accepted(context, payment, voided.id, voidAcceptedFixture);
}

function applyRefund(
  context: SimContext,
  payment: SimPayment,
  refund: SimAction,
) {
  payment.balances.total_refunded += refund.amount;
  refund.approved = true;
  payment.status =
    payment.balances.available_to_refund > 0
      ? "Partially Refunded"
      : "Refunded";
  context.events.push({ type: "payment_refunded", payment: payment.id });
}

/**
 * `POST /payments/{id}/refunds`. An amount above the refundable balance is
 * refused with 422 `refund_amount_exceeds_balance`, the code the sandbox
 * answers (observed 2026-11-10); Checkout.com's documentation names none.
 */
export function Refund(
  context: SimContext,
  request: StandInRequest,
  id: string,
): StandInReply {
  const payment = found(context, id);
  if (payment.balances.available_to_refund <= 0) {
    throw new SimError({ status: FORBIDDEN });
  }
  const amount =
    CountOf(request.body.amount) ?? payment.balances.available_to_refund;
  if (amount > payment.balances.available_to_refund) {
    throw new SimError(Problem("refund_amount_exceeds_balance"));
  }
  if (context.issuerRefusals > 0) {
    context.issuerRefusals -= 1;
    throw new SimError({
      status: 422,
      body: structuredClone(refundDeclinedFixture),
    });
  }
  const refund: SimAction = {
    ...action("Refund", amount),
    approved: undefined,
    metadata: MetadataOf(request.body.metadata),
  };
  payment.balances.available_to_refund -= amount;
  payment.actions.push(refund);
  context.later(() => applyRefund(context, payment, refund));
  return accepted(context, payment, refund.id, refundAcceptedFixture);
}
