import type {
  Amount,
  Payment,
  PaymentRequest,
} from "@antelopejs/interface-payment";
import {
  CustomerNotFoundError,
  InvalidPaymentStateError,
  PaymentError,
} from "@antelopejs/interface-payment";

import { AssertPaymentId } from "./ids";
import type { CkoClient, CkoResponse } from "./http";
import { type Account, GetAccount } from "./accounts";
import { TranslateError, Translating } from "./errors";
import { FollowPayment, LoadPayment, ReadPayment } from "./follow";
import { FindSavedMethod, RecordSavedMethod } from "./saved-methods";
import type { CkoActionAccepted, CkoMetadata, CkoPayment } from "./cko-types";
import {
  AUTOMATIC_CAPTURE,
  CAPTURE_KEY,
  MANUAL_CAPTURE,
  ToPayment,
  ToPaymentStatus,
  WriteMetadata,
} from "./mapping";

const PAYMENT_ENTITY = { entity: "payment" as const };
const ACTION_ENTITY = { entity: "payment" as const, forbiddenIsState: true };
const ALREADY_DONE = 200;
const MANDATE_CHALLENGE = "challenge_requested_mandate";

type SourceBuilder = (id: string, isSaving: boolean) => Record<string, unknown>;

/**
 * A payment method reaches Checkout.com either as a single-use token from
 * Frames or Flow (`tok_…`) or as a stored instrument (`src_…`).
 */
const SOURCE_BY_PREFIX: Record<string, SourceBuilder> = {
  src: (id) => ({ type: "id", id }),
  tok: (token, isSaving) => ({
    type: "token",
    token,
    store_for_future_use: isSaving,
  }),
};

function sourceOf(request: PaymentRequest): Record<string, unknown> {
  const method = request.paymentMethod;
  if (!method) {
    throw new PaymentError(
      "Checkout.com needs a paymentMethod to create a payment: a token from Frames or Flow (tok_…) or a saved instrument (src_…)",
    );
  }
  const build = SOURCE_BY_PREFIX[method.split("_")[0]];
  if (!build) {
    throw new CustomerNotFoundError(method, "payment method");
  }
  return build(method, Boolean(request.savePaymentMethod));
}

function assertConsistent(request: PaymentRequest): void {
  if (request.savePaymentMethod && request.offSession) {
    throw new PaymentError(
      "savePaymentMethod cannot be combined with offSession: a mandate can only be taken from a payer who is present",
    );
  }
  if (request.offSession && !request.paymentMethod) {
    throw new PaymentError(
      "An off-session payment needs a saved paymentMethod to charge",
    );
  }
  if (request.savePaymentMethod && !request.customer) {
    throw new PaymentError("savePaymentMethod requires a customer");
  }
}

async function initialPaymentOf(
  account: Account,
  request: PaymentRequest,
): Promise<string | undefined> {
  if (!request.customer || !request.paymentMethod) return undefined;
  const saved = await FindSavedMethod(
    account.client,
    request.customer,
    request.paymentMethod,
  );
  return saved?.initialPayment;
}

/**
 * How the payer's presence is declared to the card schemes. An off-session
 * charge is a merchant-initiated transaction chained to the payment that
 * stored the card; a payment that stores the card is the customer-initiated
 * start of that series, authenticated with 3DS asking for the mandate.
 */
async function initiation(
  account: Account,
  request: PaymentRequest,
): Promise<Record<string, unknown>> {
  if (request.offSession) {
    const previous = await initialPaymentOf(account, request);
    return {
      merchant_initiated: true,
      payment_type: account.merchantInitiatedType,
      ...(previous ? { previous_payment_id: previous } : {}),
    };
  }
  if (request.savePaymentMethod) {
    return {
      merchant_initiated: false,
      payment_type: account.merchantInitiatedType,
      "3ds": { enabled: true, challenge_indicator: MANDATE_CHALLENGE },
    };
  }
  return {};
}

async function buildRequest(
  account: Account,
  request: PaymentRequest,
): Promise<Record<string, unknown>> {
  return {
    source: sourceOf(request),
    amount: request.amount.value,
    currency: request.amount.currency.toUpperCase(),
    reference: request.reference,
    capture: !request.authorizeOnly,
    processing_channel_id: account.processingChannelId,
    metadata: WriteMetadata(request.metadata, {
      [CAPTURE_KEY]: request.authorizeOnly ? MANUAL_CAPTURE : AUTOMATIC_CAPTURE,
    }),
    ...(request.description ? { description: request.description } : {}),
    ...(request.customer ? { customer: { id: request.customer } } : {}),
    ...(request.returnUrl
      ? { success_url: request.returnUrl, failure_url: request.returnUrl }
      : {}),
    ...(await initiation(account, request)),
  };
}

async function linkInstrument(
  account: Account,
  instrument: string,
  customer: string,
): Promise<void> {
  await account.client.send({
    method: "PATCH",
    path: `/instruments/${instrument}`,
    body: { customer: { id: customer } },
  });
}

/**
 * The charge has happened by the time this runs, so a failure here must not
 * turn into a rejected CreatePayment that a caller would retry under a new
 * key. It is reported, and a replay of the same key runs it again.
 */
async function rememberSavedMethod(
  account: Account,
  request: PaymentRequest,
  payment: Payment,
): Promise<void> {
  const instrument = payment.paymentMethod;
  if (!request.savePaymentMethod || !request.customer || !instrument) return;
  if (payment.status === "failed" || payment.status === "canceled") return;
  try {
    if (request.paymentMethod?.startsWith("src_")) {
      await linkInstrument(account, instrument, request.customer);
    }
    await RecordSavedMethod(
      account.client,
      request.customer,
      instrument,
      payment.id,
    );
  } catch (error) {
    process.stderr.write(
      `Checkout.com: payment ${payment.id} saved ${instrument} but recording it against ${request.customer} failed (${error instanceof Error ? error.message : String(error)}); replay the same idempotency key to retry\n`,
    );
  }
}

export async function CreatePayment(
  request: PaymentRequest,
  idempotencyKey: string,
  provider?: string,
): Promise<Payment> {
  assertConsistent(request);
  const account = GetAccount(provider);
  try {
    const sent = await buildRequest(account, request);
    const { body } = await account.client.send<CkoPayment>({
      method: "POST",
      path: "/payments",
      body: sent,
      idempotencyKey,
    });
    const payment = ToPayment(
      { ...body, metadata: body.metadata ?? (sent.metadata as CkoMetadata) },
      { requested: request.amount },
    );
    await rememberSavedMethod(account, request, payment);
    return payment;
  } catch (error) {
    throw TranslateError(
      error,
      request.customer ?? request.paymentMethod ?? "",
      {
        entity: "customer",
        customer: request.customer,
        method: request.paymentMethod,
      },
    );
  }
}

export async function GetPayment(
  id: string,
  provider?: string,
): Promise<Payment> {
  AssertPaymentId(id);
  const { client } = GetAccount(provider);
  return Translating(id, PAYMENT_ENTITY, () => LoadPayment(client, id));
}

function assertNotAlreadyDone(
  response: CkoResponse<CkoActionAccepted>,
  action: string,
): void {
  if (response.status === ALREADY_DONE) {
    throw new InvalidPaymentStateError(
      `The payment is already ${action}`,
      undefined,
      `already_${action}`,
    );
  }
}

function hasLeftAuthorization(payment: CkoPayment): boolean {
  const status = ToPaymentStatus(payment);
  return status !== "authorized" && status !== "pending";
}

/**
 * A payment this module asked Checkout.com to capture automatically reads
 * `pending` until it is captured, and the contract allows a capture only of an
 * `authorized` one. Refusing on the creation marker rather than on the current
 * status keeps a replayed capture of an `authorizeOnly` payment answerable.
 */
async function assertCapturable(client: CkoClient, id: string): Promise<void> {
  const payment = await ReadPayment(client, id);
  if (payment.metadata?.[CAPTURE_KEY] !== AUTOMATIC_CAPTURE) return;
  throw new InvalidPaymentStateError(
    "Checkout.com captures this payment by itself; it was not created with authorizeOnly",
    ToPaymentStatus(payment),
    "automatic_capture",
  );
}

export async function CapturePayment(
  id: string,
  idempotencyKey: string,
  amount?: Amount,
  provider?: string,
): Promise<Payment> {
  AssertPaymentId(id);
  const { client, settleTimeoutMs } = GetAccount(provider);
  return Translating(id, ACTION_ENTITY, async () => {
    await assertCapturable(client, id);
    const accepted = await client.send<CkoActionAccepted>({
      method: "POST",
      path: `/payments/${id}/captures`,
      body: amount ? { amount: amount.value } : {},
      idempotencyKey,
    });
    assertNotAlreadyDone(accepted, "captured");
    return FollowPayment(client, id, hasLeftAuthorization, settleTimeoutMs);
  });
}

export async function CancelPayment(
  id: string,
  idempotencyKey: string,
  provider?: string,
): Promise<Payment> {
  AssertPaymentId(id);
  const { client, settleTimeoutMs } = GetAccount(provider);
  return Translating(id, ACTION_ENTITY, async () => {
    const accepted = await client.send<CkoActionAccepted>({
      method: "POST",
      path: `/payments/${id}/voids`,
      body: {},
      idempotencyKey,
    });
    assertNotAlreadyDone(accepted, "voided");
    return FollowPayment(client, id, hasLeftAuthorization, settleTimeoutMs);
  });
}
