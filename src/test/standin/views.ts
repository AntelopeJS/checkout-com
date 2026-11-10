import { Scheme } from "./cards";
import paymentFixture from "./fixtures/payment-201.json";
import actionsFixture from "./fixtures/payment-actions.json";
import detailsFixture from "./fixtures/payment-details.json";
import declinedFixture from "./fixtures/payment-201-declined.json";
import redirectFixture from "./fixtures/payment-202-redirect.json";
import { type JsonObject, ObjectOf } from "./wire";
import type {
  SimAction,
  SimCustomer,
  SimInstrument,
  SimPayment,
  SimState,
} from "./state";

function link(baseUrl: string, path: string): JsonObject {
  return { href: `${baseUrl}${path}` };
}

function cardSource(
  instrument: SimInstrument,
  base: JsonObject | undefined,
): JsonObject {
  const { card } = instrument;
  return {
    ...base,
    id: instrument.id,
    type: "card",
    scheme: Scheme(card),
    last4: card.number.slice(-4),
    bin: card.number.slice(0, 6),
    expiry_month: card.expiryMonth,
    expiry_year: card.expiryYear,
  };
}

function customerView(
  customer: SimCustomer | undefined,
): JsonObject | undefined {
  if (!customer) return undefined;
  const view: JsonObject = { id: customer.id, email: customer.email };
  if (customer.name) view.name = customer.name;
  return view;
}

function paymentLinks(baseUrl: string, payment: SimPayment): JsonObject {
  const path = `/payments/${payment.id}`;
  const links: JsonObject = {
    self: link(baseUrl, path),
    actions: link(baseUrl, `${path}/actions`),
  };
  if (payment.balances.available_to_capture > 0) {
    links.capture = link(baseUrl, `${path}/captures`);
  }
  if (payment.balances.available_to_void > 0) {
    links.void = link(baseUrl, `${path}/voids`);
  }
  if (payment.balances.available_to_refund > 0) {
    links.refund = link(baseUrl, `${path}/refunds`);
  }
  if (payment.redirectUrl) links.redirect = { href: payment.redirectUrl };
  return links;
}

function withParties(
  state: SimState,
  payment: SimPayment,
  body: JsonObject,
): JsonObject {
  const instrument = payment.instrument
    ? state.instruments.get(payment.instrument)
    : undefined;
  const customer = customerView(
    payment.customer ? state.customers.get(payment.customer) : undefined,
  );
  const view: JsonObject = { ...body };
  if (instrument) view.source = cardSource(instrument, ObjectOf(body.source));
  if (!instrument) delete view.source;
  if (customer) view.customer = customer;
  if (!customer) delete view.customer;
  return view;
}

/** `POST /payments` 201, from the spec's PaymentResponse example. */
export function PaymentResponse(
  state: SimState,
  payment: SimPayment,
  baseUrl: string,
): JsonObject {
  const fixture = payment.approved ? paymentFixture : declinedFixture;
  const [authorization] = payment.actions;
  const body: JsonObject = {
    ...structuredClone(fixture),
    id: payment.id,
    action_id: authorization?.id,
    amount: payment.amount,
    currency: payment.currency,
    approved: payment.approved,
    status: payment.status,
    response_code: payment.responseCode,
    response_summary: payment.responseSummary,
    processed_on: payment.requestedOn,
    reference: payment.reference,
    balances: { ...payment.balances },
    _links: paymentLinks(baseUrl, payment),
  };
  return withParties(state, payment, body);
}

/** `POST /payments` 202, from the documented 3DS redirect example: no `source` until the payer is past 3DS. */
export function PaymentAccepted(
  state: SimState,
  payment: SimPayment,
  baseUrl: string,
): JsonObject {
  const body: JsonObject = {
    ...structuredClone(redirectFixture),
    id: payment.id,
    status: "Pending",
    reference: payment.reference,
    _links: {
      self: link(baseUrl, `/payments/${payment.id}`),
      redirect: { href: payment.redirectUrl },
    },
  };
  delete body.instruction;
  const view = withParties(state, payment, body);
  delete view.source;
  return view;
}

/** `GET /payments/{id}`, from the documented captured-payment example. */
export function PaymentDetails(
  state: SimState,
  payment: SimPayment,
  baseUrl: string,
): JsonObject {
  const body: JsonObject = {
    ...structuredClone(detailsFixture),
    id: payment.id,
    requested_on: payment.requestedOn,
    amount: payment.amount,
    currency: payment.currency,
    payment_type: payment.paymentType,
    status: payment.status,
    approved: payment.approved,
    balances: { ...payment.balances },
    reference: payment.reference,
    _links: paymentLinks(baseUrl, payment),
  };
  delete body["3ds"];
  delete body.eci;
  if (payment.description) body.description = payment.description;
  if (payment.metadata) body.metadata = { ...payment.metadata };
  return withParties(state, payment, body);
}

/** `GET /payments/{id}/actions`, latest first, as the docs' example shows. */
export function PaymentActions(payment: SimPayment): JsonObject[] {
  const [example] = actionsFixture;
  return [...payment.actions].reverse().map((action: SimAction) => {
    const body: JsonObject = {
      ...structuredClone(example),
      approved: undefined,
      id: action.id,
      type: action.type,
      processed_on: action.processedOn,
      amount: action.amount,
      response_code: action.responseCode,
      response_summary: action.responseSummary,
    };
    if (action.approved !== undefined) body.approved = action.approved;
    if (action.metadata) body.metadata = { ...action.metadata };
    if (!action.metadata) delete body.metadata;
    return body;
  });
}
