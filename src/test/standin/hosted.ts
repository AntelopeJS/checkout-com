import { IssueToken } from "./vault";
import { SubmitPayment } from "./payments";
import createdFixture from "./fixtures/hosted-201.json";
import pendingFixture from "./fixtures/hosted-pending.json";
import type { StandInReply, StandInRequest } from "./server";
import { NewHostedId, type SimHostedPayment } from "./state";
import receivedFixture from "./fixtures/hosted-received.json";
import { Problem, type SimContext, SimError } from "./context";
import { type JsonObject, ObjectOf, isText } from "./wire";

const CREATED = 201;
const OK = 200;
const NOT_FOUND = 404;
const REFERENCE_LIMIT = 50;
const LIFETIME_MS = 24 * 60 * 60 * 1000;
const REQUIRED_URLS = ["success_url", "cancel_url", "failure_url"];
const PAGE_HOST = "https://pay.sandbox.checkout.com/page";

function assertValid(body: JsonObject): void {
  if (!isText(body.currency)) {
    throw new SimError(Problem("currency_required"));
  }
  const billing = ObjectOf(body.billing);
  if (!ObjectOf(billing?.address)?.country) {
    throw new SimError(Problem("billing_address_country_required"));
  }
  const missing = REQUIRED_URLS.find((field) => !isText(body[field]));
  if (missing) throw new SimError(Problem(`${missing}_required`));
  if (isText(body.reference) && body.reference.length > REFERENCE_LIMIT) {
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
      ...structuredClone(createdFixture),
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
  const body: JsonObject = {
    ...structuredClone(fixture),
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

function pageRequest(hosted: SimHostedPayment, token: string): JsonObject {
  const { request } = hosted;
  const configuration = ObjectOf(request.payment_method_configuration);
  const card = ObjectOf(configuration?.card);
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
  const { token } = IssueToken(context, {
    number: cardNumber,
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 3,
  });
  const { payment } = SubmitPayment(context, pageRequest(hosted, token));
  hosted.paymentId = payment.id;
  if (payment.approved) hosted.status = "Payment Received";
  return payment.id;
}
