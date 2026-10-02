import { Scheme } from "./cards";
import tokenFixture from "./fixtures/token-201.json";
import type { StandInReply, StandInRequest } from "./server";
import { Problem, type SimContext, SimError } from "./context";
import customerFixture from "./fixtures/customer-details.json";
import instrumentFixture from "./fixtures/instrument-201.json";
import customerCreatedFixture from "./fixtures/customer-201.json";
import emailTakenFixture from "./fixtures/customer-422-email-exists.json";
import {
  type Metadata,
  NewId,
  type SimCard,
  type SimCustomer,
  type SimInstrument,
} from "./state";

const CREATED = 201;
const OK = 200;
const NO_CONTENT = 204;
const NOT_FOUND = 404;
const UNPROCESSABLE = 422;
const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const CUSTOMER_METADATA_PAIRS = 20;
const CUSTOMER_METADATA_LENGTH = 100;

type Body = Record<string, unknown>;

export interface ResolvedSource {
  card: SimCard;
  instrument?: SimInstrument;
  customer?: string;
  commit: (isApproved: boolean) => void;
}

function cardView(card: SimCard, base: Body): Body {
  return {
    ...base,
    scheme: Scheme(card),
    last4: card.number.slice(-4),
    bin: card.number.slice(0, 6),
    expiry_month: card.expiryMonth,
    expiry_year: card.expiryYear,
  };
}

function useToken(context: SimContext, token: unknown): SimCard {
  const stored = context.state.tokens.get(token as string);
  if (!stored) throw new SimError(Problem("token_invalid"));
  if (stored.isUsed) throw new SimError(Problem("token_used"));
  if (stored.expiresAt < Date.now())
    throw new SimError(Problem("token_expired"));
  stored.isUsed = true;
  return stored.card;
}

function payingCustomer(
  context: SimContext,
  customer: Body | undefined,
): string | undefined {
  if (!customer) return undefined;
  if (customer.id) {
    if (!context.state.customers.has(customer.id as string)) {
      throw new SimError(Problem("customer_not_found"));
    }
    return customer.id as string;
  }
  if (typeof customer.email !== "string") return undefined;
  const existing = context.state.customerByEmail(customer.email);
  if (existing) return existing.id;
  const created = newCustomer(customer.email, customer.name as string, {});
  context.state.customers.set(created.id, created);
  return created.id;
}

function storedInstrument(context: SimContext, id: unknown): SimInstrument {
  const instrument = context.state.instruments.get(id as string);
  if (!instrument) throw new SimError(Problem("source_id_unknown"));
  return instrument;
}

function tokenSource(
  context: SimContext,
  source: Body,
  customer: string | undefined,
  isStoring: boolean,
): ResolvedSource {
  const card = useToken(context, source.token);
  if (source.store_for_future_use === false && !isStoring) {
    return { card, customer, commit: () => undefined };
  }
  const instrument: SimInstrument = { id: NewId("src"), card, customer };
  const commit = (isApproved: boolean) => {
    if (isApproved) context.state.instruments.set(instrument.id, instrument);
    else context.state.instruments.delete(instrument.id);
  };
  return { card, instrument, customer, commit };
}

/**
 * The `source` of a payment request: a single-use token (stored as a new
 * instrument once approved, unless `store_for_future_use` is false), a stored
 * instrument, or a customer's default instrument.
 */
export function ResolveSource(
  context: SimContext,
  body: Body,
  isStoring: boolean,
): ResolvedSource {
  const source = body.source as Body | undefined;
  const customer = payingCustomer(context, body.customer as Body | undefined);
  if (source?.type === "token") {
    return tokenSource(context, source, customer, isStoring);
  }
  if (source?.type === "id") {
    const instrument = storedInstrument(context, source.id);
    return {
      card: instrument.card,
      instrument,
      customer,
      commit: () => undefined,
    };
  }
  if (source?.type === "customer") {
    const owner = context.state.customers.get(source.id as string);
    const instrument = storedInstrument(context, owner?.defaultInstrument);
    return {
      card: instrument.card,
      instrument,
      customer: owner?.id,
      commit: () => undefined,
    };
  }
  throw new SimError(Problem("payment_source_required"));
}

/** `POST /tokens` (public key): card details for a 15-minute, single-use token. */
export function CreateToken(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  const { body } = request;
  const card: SimCard = {
    number: typeof body.number === "string" ? body.number : "",
    expiryMonth: Number(body.expiry_month),
    expiryYear: Number(body.expiry_year),
  };
  if (!/^\d{12,19}$/.test(card.number)) {
    throw new SimError(Problem("card_number_invalid"));
  }
  const token = NewId("tok");
  const expiresAt = Date.now() + TOKEN_LIFETIME_MS;
  context.state.tokens.set(token, {
    id: token,
    card,
    isUsed: false,
    expiresAt,
  });
  return {
    status: CREATED,
    body: {
      ...cardView(card, structuredClone(tokenFixture) as Body),
      token,
      expires_on: new Date(expiresAt).toISOString(),
    },
  };
}

function instrumentView(instrument: SimInstrument): Body {
  const view = cardView(instrument.card, {
    ...(structuredClone(instrumentFixture) as Body),
    id: instrument.id,
  });
  if (instrument.customer) view.customer = { id: instrument.customer };
  return view;
}

/** `POST /instruments` with a token, optionally linked to a customer. */
export function CreateInstrument(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  const { body } = request;
  if (body.type !== "token")
    throw new SimError(Problem("instrument_type_invalid"));
  const card = useToken(context, body.token);
  const customer = payingCustomer(context, body.customer as Body | undefined);
  const instrument: SimInstrument = { id: NewId("src"), card, customer };
  context.state.instruments.set(instrument.id, instrument);
  return { status: CREATED, body: instrumentView(instrument) };
}

function instrumentOr404(context: SimContext, id: string): SimInstrument {
  const instrument = context.state.instruments.get(id);
  if (!instrument) throw new SimError({ status: NOT_FOUND });
  return instrument;
}

export function GetInstrument(context: SimContext, id: string): StandInReply {
  return { status: OK, body: instrumentView(instrumentOr404(context, id)) };
}

/** `PATCH /instruments/{id}`: linking to a customer, refused if already linked elsewhere. */
export function UpdateInstrument(
  context: SimContext,
  request: StandInRequest,
  id: string,
): StandInReply {
  const instrument = instrumentOr404(context, id);
  const customer = (request.body.customer as Body | undefined)?.id as
    | string
    | undefined;
  if (customer && !context.state.customers.has(customer)) {
    throw new SimError(Problem("customer_not_found"));
  }
  if (customer && instrument.customer && instrument.customer !== customer) {
    throw new SimError(Problem("instrument_already_has_customer"));
  }
  if (customer) instrument.customer = customer;
  return { status: OK, body: { type: "card", fingerprint: instrument.id } };
}

export function DeleteInstrument(
  context: SimContext,
  id: string,
): StandInReply {
  instrumentOr404(context, id);
  context.state.instruments.delete(id);
  return { status: NO_CONTENT };
}

/**
 * "A maximum of 20 key-value pairs. Each key and value can be up to 100
 * characters long." The error code for exceeding it is not documented.
 */
function assertCustomerMetadata(metadata: unknown): void {
  const entries = Object.entries((metadata as Metadata | undefined) ?? {});
  const isTooLong = entries.some(
    ([field, value]) =>
      field.length > CUSTOMER_METADATA_LENGTH ||
      String(value).length > CUSTOMER_METADATA_LENGTH,
  );
  if (entries.length > CUSTOMER_METADATA_PAIRS || isTooLong) {
    throw new SimError(Problem("metadata_key_invalid"));
  }
}

function newCustomer(
  email: string,
  name: string | undefined,
  metadata: Metadata,
): SimCustomer {
  return { id: NewId("cus"), email, metadata, ...(name ? { name } : {}) };
}

/** `POST /customers`: email required and unique. */
export function CreateCustomer(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  const { email, name, metadata } = request.body;
  assertCustomerMetadata(metadata);
  if (typeof email !== "string" || !email.includes("@")) {
    throw new SimError(Problem("customer_email_invalid"));
  }
  if (context.state.customerByEmail(email)) {
    throw new SimError({
      status: UNPROCESSABLE,
      body: structuredClone(emailTakenFixture),
    });
  }
  const customer = newCustomer(
    email,
    name as string | undefined,
    (metadata as Metadata) ?? {},
  );
  context.state.customers.set(customer.id, customer);
  return {
    status: CREATED,
    body: { ...structuredClone(customerCreatedFixture), id: customer.id },
  };
}

function customerOr404(context: SimContext, identifier: string): SimCustomer {
  const decoded = decodeURIComponent(identifier);
  const customer =
    context.state.customers.get(decoded) ??
    context.state.customerByEmail(decoded);
  if (!customer) throw new SimError({ status: NOT_FOUND });
  return customer;
}

/** `GET /customers/{id or email}`, with the customer's instruments inside. */
export function GetCustomer(
  context: SimContext,
  identifier: string,
): StandInReply {
  const customer = customerOr404(context, identifier);
  const [instrumentShape] = customerFixture.instruments;
  const body: Body = {
    ...(structuredClone(customerFixture) as Body),
    id: customer.id,
    email: customer.email,
    metadata: { ...customer.metadata },
    instruments: context.state.instrumentsOf(customer.id).map((instrument) =>
      cardView(instrument.card, {
        ...structuredClone(instrumentShape),
        id: instrument.id,
      }),
    ),
  };
  delete body.phone;
  if (customer.name) body.name = customer.name;
  if (!customer.name) delete body.name;
  if (customer.defaultInstrument) body.default = customer.defaultInstrument;
  if (!customer.defaultInstrument) delete body.default;
  return { status: OK, body };
}

/** `PATCH /customers/{id}`: metadata, when given, replaces what was stored. */
export function UpdateCustomer(
  context: SimContext,
  request: StandInRequest,
  id: string,
): StandInReply {
  const customer = customerOr404(context, id);
  const { metadata, name, default: preferred } = request.body;
  assertCustomerMetadata(metadata);
  if (metadata) customer.metadata = metadata as Metadata;
  if (typeof name === "string") customer.name = name;
  if (typeof preferred === "string") customer.defaultInstrument = preferred;
  return { status: NO_CONTENT };
}

/** `DELETE /customers/{id}`: the customer and every linked instrument. */
export function DeleteCustomer(context: SimContext, id: string): StandInReply {
  const customer = customerOr404(context, id);
  for (const instrument of context.state.instrumentsOf(customer.id)) {
    context.state.instruments.delete(instrument.id);
  }
  context.state.customers.delete(customer.id);
  return { status: NO_CONTENT };
}
