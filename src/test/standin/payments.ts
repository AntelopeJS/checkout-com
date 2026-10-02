import { ResolveSource } from "./vault";
import voidAcceptedFixture from "./fixtures/void-202.json";
import type { StandInReply, StandInRequest } from "./server";
import refundAcceptedFixture from "./fixtures/refund-202.json";
import { type CardBehaviour, CardOutcome, NotEnrolled } from "./cards";
import refundDeclinedFixture from "./fixtures/refund-422-declined.json";
import { Problem, type SimContext, SimError, ToCurrencyRule } from "./context";
import {
  PaymentAccepted,
  PaymentActions,
  PaymentDetails,
  PaymentResponse,
} from "./views";
import {
  EmptyBalances,
  type Metadata,
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
const REFUND_DECLINED_AMOUNT = 3738;
const REGULAR = "Regular";
const FAILED_AUTHENTICATION: CardBehaviour = {
  responseCode: "20151",
  responseSummary: "Cardholder failed 3DS authentication",
  threeDs: "challenge",
};
const SELF_STORING_TYPES = new Set(["Recurring", "Installment", "Unscheduled"]);

type Body = Record<string, unknown>;

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

function assertInitiation(context: SimContext, body: Body): void {
  const paymentType = (body.payment_type as string | undefined) ?? REGULAR;
  if (body.merchant_initiated === true && paymentType === REGULAR) {
    throw new SimError(Problem("payment_type_invalid"));
  }
  const previous = body.previous_payment_id as string | undefined;
  if (previous && !context.state.payments.has(previous)) {
    throw new SimError(Problem("previous_payment_id_invalid"));
  }
}

function isThreeDsRequested(body: Body): boolean {
  const threeDs = body["3ds"] as Body | undefined;
  return threeDs?.enabled === true || threeDs?.enabled === "true";
}

function needsChallenge(behaviour: CardBehaviour, body: Body): boolean {
  if (behaviour.threeDs === "upgrade") return true;
  return behaviour.threeDs === "challenge" && isThreeDsRequested(body);
}

function decide(behaviour: CardBehaviour, body: Body): CardBehaviour {
  return behaviour.threeDs === "not_enabled" && isThreeDsRequested(body)
    ? NotEnrolled()
    : behaviour;
}

function newPayment(
  body: Body,
  instrument: SimInstrument | undefined,
  customer: string | undefined,
): SimPayment {
  const payment: SimPayment = {
    id: NewId("pay"),
    amount: body.amount as number,
    currency: body.currency as string,
    status: "Pending",
    approved: false,
    reference: body.reference as string | undefined,
    description: body.description as string | undefined,
    requestedOn: now(),
    instrument: instrument?.id,
    customer: customer ?? instrument?.customer,
    metadata: body.metadata as Metadata | undefined,
    paymentType: (body.payment_type as string | undefined) ?? REGULAR,
    isMerchantInitiated: body.merchant_initiated === true,
    previousPaymentId: body.previous_payment_id as string | undefined,
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

/** `POST /payments`: authorization, 3DS by test card, MIT validation. */
export function CreatePayment(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  const { body } = request;
  ToCurrencyRule(body.currency, body.amount);
  assertInitiation(context, body);
  const isStoring =
    SELF_STORING_TYPES.has(body.payment_type as string) &&
    body.merchant_initiated !== true;
  const source = ResolveSource(context, body, isStoring);
  const payment = newPayment(body, source.instrument, source.customer);
  context.state.payments.set(payment.id, payment);
  const behaviour = CardOutcome(source.card, payment.amount);
  if (needsChallenge(behaviour, body)) {
    payment.redirectUrl = `${context.baseUrl}/3ds/${payment.id}`;
    context.challenges.set(payment.id, { behaviour, commit: source.commit });
    source.commit(true);
    return {
      status: ACCEPTED,
      body: PaymentAccepted(context.state, payment, context.baseUrl),
    };
  }
  authorize(context, payment, decide(behaviour, body));
  source.commit(payment.approved);
  return {
    status: CREATED,
    body: PaymentResponse(context.state, payment, context.baseUrl),
  };
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
  fixture: unknown,
): StandInReply {
  return {
    status: ACCEPTED,
    body: {
      ...(structuredClone(fixture) as Body),
      action_id: actionId,
      reference: payment.reference,
      _links: {
        payment: { href: `${context.baseUrl}/payments/${payment.id}` },
      },
    },
  };
}

/** `POST /payments/{id}/captures`: 403 unless authorized, then async. */
export function Capture(
  context: SimContext,
  request: StandInRequest,
  id: string,
): StandInReply {
  const payment = found(context, id);
  if (payment.status !== "Authorized")
    throw new SimError({ status: FORBIDDEN });
  const amount =
    (request.body.amount as number | undefined) ??
    payment.balances.available_to_capture;
  if (amount > payment.balances.available_to_capture) {
    throw new SimError(Problem("capture_value_greater_than_authorized"));
  }
  const actionId = NewId("act");
  context.later(() => capture(context, payment, amount, actionId));
  return accepted(context, payment, actionId, voidAcceptedFixture);
}

/** `POST /payments/{id}/voids`: 403 unless authorized, then async. */
export function Void(context: SimContext, id: string): StandInReply {
  const payment = found(context, id);
  if (payment.status !== "Authorized")
    throw new SimError({ status: FORBIDDEN });
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
 * `POST /payments/{id}/refunds`. Checkout.com documents no refund-specific
 * code for an amount above the refundable balance; `amount_exceeds_balance`
 * is the documented balance code this stand-in answers with.
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
    (request.body.amount as number | undefined) ??
    payment.balances.available_to_refund;
  if (amount > payment.balances.available_to_refund) {
    throw new SimError(Problem("amount_exceeds_balance"));
  }
  if (amount === REFUND_DECLINED_AMOUNT) {
    throw new SimError({
      status: 422,
      body: structuredClone(refundDeclinedFixture),
    });
  }
  const refund: SimAction = {
    ...action("Refund", amount),
    approved: undefined,
    metadata: request.body.metadata as Metadata | undefined,
  };
  payment.balances.available_to_refund -= amount;
  payment.actions.push(refund);
  context.later(() => applyRefund(context, payment, refund));
  return accepted(context, payment, refund.id, refundAcceptedFixture);
}
