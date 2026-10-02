import { Scheme } from "./cards";
import paymentFixture from "./fixtures/payment-201.json";
import actionsFixture from "./fixtures/payment-actions.json";
import detailsFixture from "./fixtures/payment-details.json";
import declinedFixture from "./fixtures/payment-201-declined.json";
import redirectFixture from "./fixtures/payment-202-redirect.json";
import type {
  SimAction,
  SimCustomer,
  SimInstrument,
  SimPayment,
  SimState,
} from "./state";

type Body = Record<string, unknown>;

function clone<T>(fixture: T): Body {
  return structuredClone(fixture) as Body;
}

function link(baseUrl: string, path: string): Body {
  return { href: `${baseUrl}${path}` };
}

function cardSource(instrument: SimInstrument, base: Body): Body {
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

function customerView(customer: SimCustomer | undefined): Body | undefined {
  if (!customer) return undefined;
  return {
    id: customer.id,
    email: customer.email,
    ...(customer.name ? { name: customer.name } : {}),
  };
}

function paymentLinks(baseUrl: string, payment: SimPayment): Body {
  const path = `/payments/${payment.id}`;
  const links: Body = {
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
  return links;
}

function withParties(state: SimState, payment: SimPayment, body: Body): Body {
  const instrument = payment.instrument
    ? state.instruments.get(payment.instrument)
    : undefined;
  const customer = customerView(
    payment.customer ? state.customers.get(payment.customer) : undefined,
  );
  const view: Body = { ...body };
  if (instrument) view.source = cardSource(instrument, body.source as Body);
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
): Body {
  const fixture = payment.approved ? paymentFixture : declinedFixture;
  const [authorization] = payment.actions;
  const body: Body = {
    ...clone(fixture),
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

/** `POST /payments` 202, from the documented 3DS redirect example. */
export function PaymentAccepted(
  state: SimState,
  payment: SimPayment,
  baseUrl: string,
): Body {
  const body: Body = {
    ...clone(redirectFixture),
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
  if (view.source) view.source = { type: "id", id: payment.instrument };
  return view;
}

/** `GET /payments/{id}`, from the documented captured-payment example. */
export function PaymentDetails(
  state: SimState,
  payment: SimPayment,
  baseUrl: string,
): Body {
  const body: Body = {
    ...clone(detailsFixture),
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

/** `GET /payments/{id}/actions`, latest first, shaped as the docs' example. */
export function PaymentActions(payment: SimPayment): Body[] {
  const [shape] = actionsFixture;
  return [...payment.actions].reverse().map((action: SimAction) => {
    const body: Body = {
      ...clone(shape),
      approved: undefined,
      id: action.id,
      type: action.type,
      processed_on: action.processedOn,
      amount: action.amount,
      ...(action.approved === undefined ? {} : { approved: action.approved }),
      response_code: action.responseCode,
      response_summary: action.responseSummary,
    };
    if (action.metadata) body.metadata = { ...action.metadata };
    if (!action.metadata) delete body.metadata;
    return body;
  });
}
