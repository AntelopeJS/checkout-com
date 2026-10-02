import { CreateToken } from "./vault";
import { CreatePayment } from "./payments";
import createdFixture from "./fixtures/hosted-201.json";
import pendingFixture from "./fixtures/hosted-pending.json";
import type { StandInReply, StandInRequest } from "./server";
import { NewHostedId, type SimHostedPayment } from "./state";
import receivedFixture from "./fixtures/hosted-received.json";
import { Problem, type SimContext, SimError } from "./context";

const CREATED = 201;
const OK = 200;
const NOT_FOUND = 404;
const REFERENCE_LIMIT = 50;
const LIFETIME_MS = 24 * 60 * 60 * 1000;
const REQUIRED_URLS = ["success_url", "cancel_url", "failure_url"];
const PAGE_HOST = "https://pay.sandbox.checkout.com/page";

type Body = Record<string, unknown>;

function assertValid(body: Body): void {
  if (typeof body.currency !== "string") {
    throw new SimError(Problem("currency_required"));
  }
  const billing = body.billing as Body | undefined;
  if (!(billing?.address as Body | undefined)?.country) {
    throw new SimError(Problem("billing_address_country_required"));
  }
  const missing = REQUIRED_URLS.find(
    (field) => typeof body[field] !== "string",
  );
  if (missing) throw new SimError(Problem(`${missing}_required`));
  if (
    typeof body.reference === "string" &&
    body.reference.length > REFERENCE_LIMIT
  ) {
    throw new SimError(Problem("reference_too_long"));
  }
}

/** `POST /hosted-payments`: the required fields of HostedPaymentsRequest. */
export function CreateHostedPayment(
  context: SimContext,
  request: StandInRequest,
): StandInReply {
  assertValid(request.body);
  const hosted: SimHostedPayment = {
    id: NewHostedId(),
    status: "Payment Pending",
    request: request.body,
    createdAt: Date.now(),
  };
  context.state.hosted.set(hosted.id, hosted);
  return {
    status: CREATED,
    body: {
      ...(structuredClone(createdFixture) as Body),
      id: hosted.id,
      reference: request.body.reference,
      _links: {
        self: { href: `${context.baseUrl}/hosted-payments/${hosted.id}` },
        redirect: { href: `${PAGE_HOST}/${hosted.id}` },
      },
    },
  };
}

function statusOf(hosted: SimHostedPayment): string {
  return hosted.status === "Payment Pending" &&
    hosted.createdAt + LIFETIME_MS < Date.now()
    ? "Expired"
    : hosted.status;
}

/** `GET /hosted-payments/{id}`, including the docs' literal "undefined". */
export function GetHostedPayment(
  context: SimContext,
  id: string,
): StandInReply {
  const hosted = context.state.hosted.get(id);
  if (!hosted) throw new SimError({ status: NOT_FOUND });
  const status = statusOf(hosted);
  const fixture =
    status === "Payment Received" ? receivedFixture : pendingFixture;
  const { request } = hosted;
  const body: Body = {
    ...(structuredClone(fixture) as Body),
    id: hosted.id,
    status,
    payment_id: hosted.paymentId ?? "undefined",
    amount: request.amount,
    currency: request.currency,
    reference: request.reference,
    expires_on: new Date(hosted.createdAt + LIFETIME_MS).toISOString(),
    metadata: request.metadata,
    _links: {
      self: { href: `${context.baseUrl}/hosted-payments/${hosted.id}` },
      redirect: { href: `${PAGE_HOST}/${hosted.id}` },
    },
  };
  delete body.products;
  return { status: OK, body };
}

function pageRequest(hosted: SimHostedPayment, token: string): Body {
  const { request } = hosted;
  const configuration = request.payment_method_configuration as
    | Body
    | undefined;
  const card = configuration?.card as Body | undefined;
  return {
    source: {
      type: "token",
      token,
      store_for_future_use: card?.store_payment_details === "enabled",
    },
    amount: request.amount,
    currency: request.currency,
    reference: request.reference,
    capture: request.capture,
    customer: request.customer,
    metadata: request.metadata,
    payment_type: request.payment_type,
    processing_channel_id: request.processing_channel_id,
  };
}

/**
 * The payer paying on the hosted page with a test card. The page makes an
 * ordinary payment, which is how its outcome, storing and capture are
 * modelled; whether Checkout.com copies the session's metadata onto that
 * payment is not documented, and this stand-in assumes it does.
 */
export function PayHostedPage(
  context: SimContext,
  id: string,
  cardNumber: string,
): string {
  const hosted = context.state.hosted.get(id);
  if (!hosted) throw new Error(`No hosted payment ${id}`);
  const tokenReply = CreateToken(context, {
    method: "POST",
    path: "/tokens",
    query: new URLSearchParams(),
    headers: {},
    body: {
      type: "card",
      number: cardNumber,
      expiry_month: 12,
      expiry_year: new Date().getFullYear() + 3,
    },
  });
  const token = (tokenReply.body as Body).token as string;
  const paid = CreatePayment(context, {
    method: "POST",
    path: "/payments",
    query: new URLSearchParams(),
    headers: {},
    body: pageRequest(hosted, token),
  });
  const payment = (paid.body as Body).id as string;
  hosted.paymentId = payment;
  if ((paid.body as Body).approved === true) hosted.status = "Payment Received";
  return payment;
}
