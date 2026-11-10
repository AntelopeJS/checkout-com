import { IsCkoActionAccepted, IsCkoPayment } from "./resources";
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
import { FindSavedMethod, RememberSave } from "./saved-methods";
import { LookUp } from "./lookup";
import type {
  CkoActionAccepted,
  CkoInitiation,
  CkoPayment,
  CkoPaymentRequest,
  CkoPaymentSource,
} from "./cko-types";
import {
  AUTOMATIC_CAPTURE,
  CAPTURE_KEY,
  InternalMetadataOf,
  SAVE_FOR_KEY,
  ToPayment,
  ToPaymentStatus,
  WriteMetadata,
} from "./mapping";

const PAYMENT_ENTITY = { entity: "payment" as const };
const ACTION_ENTITY = { entity: "payment" as const, forbiddenIsState: true };
const ALREADY_DONE = 200;
const MANDATE_CHALLENGE = "challenge_requested_mandate";

type SourceBuilder = (id: string, isSaving: boolean) => CkoPaymentSource;

/**
 * A payment method reaches Checkout.com either as a single-use token from
 * Frames or Flow (`tok_…`) or as a stored instrument (`src_…`).
 */
const SOURCE_BY_PREFIX = {
  src: (id) => ({ type: "id", id }),
  tok: (token, isSaving) => ({
    type: "token",
    token,
    store_for_future_use: isSaving,
  }),
} satisfies Record<string, SourceBuilder>;

function sourceOf(request: PaymentRequest): CkoPaymentSource {
  const method = request.paymentMethod;
  if (!method) {
    throw new PaymentError(
      "Checkout.com needs a paymentMethod to create a payment: a token from Frames or Flow (tok_…) or a saved instrument (src_…)",
    );
  }
  const build = LookUp<SourceBuilder>(SOURCE_BY_PREFIX, method.split("_")[0]);
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

/**
 * The payment that saved the card, for the chain. A customer's off-session
 * charge must use a card that customer has: a card its payer never
 * authenticated is linked to no customer, so it is refused here rather than
 * charged as though the payer had agreed to it.
 */
async function initialPaymentOf(
  account: Account,
  request: PaymentRequest,
): Promise<string | undefined> {
  if (!request.customer || !request.paymentMethod) return undefined;
  const found = await FindSavedMethod(
    account.client,
    request.customer,
    request.paymentMethod,
  );
  if (!found.isListed) {
    throw new CustomerNotFoundError(request.paymentMethod, "payment method");
  }
  return found.saved?.initialPayment;
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
): Promise<CkoInitiation> {
  if (request.offSession) {
    const previous = await initialPaymentOf(account, request);
    const initiation: CkoInitiation = {
      merchant_initiated: true,
      payment_type: account.merchantInitiatedType,
    };
    if (previous) {
      initiation.previous_payment_id = previous;
    }
    return initiation;
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
): Promise<CkoPaymentRequest> {
  const sent: CkoPaymentRequest = {
    source: sourceOf(request),
    amount: request.amount.value,
    currency: request.amount.currency.toUpperCase(),
    reference: request.reference,
    capture: !request.authorizeOnly,
    processing_channel_id: account.processingChannelId,
    metadata: WriteMetadata(request.metadata, InternalMetadataOf(request)),
  };
  if (request.description) {
    sent.description = request.description;
  }
  if (request.customer && !request.savePaymentMethod) {
    sent.customer = { id: request.customer };
  }
  if (request.returnUrl) {
    sent.success_url = request.returnUrl;
    sent.failure_url = request.returnUrl;
  }
  return { ...sent, ...(await initiation(account, request)) };
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
    const { body } = await account.client.send(
      {
        method: "POST",
        path: "/payments",
        body: sent,
        idempotencyKey,
      },
      IsCkoPayment,
    );
    const payment = ToPayment(
      { ...body, metadata: body.metadata ?? sent.metadata },
      { requested: request.amount },
    );
    await RememberSave(account.client, sent.metadata?.[SAVE_FOR_KEY], payment);
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
    const accepted = await client.send(
      {
        method: "POST",
        path: `/payments/${id}/captures`,
        body: amount ? { amount: amount.value } : {},
        idempotencyKey,
      },
      IsCkoActionAccepted,
    );
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
    const accepted = await client.send(
      {
        method: "POST",
        path: `/payments/${id}/voids`,
        body: {},
        idempotencyKey,
      },
      IsCkoActionAccepted,
    );
    assertNotAlreadyDone(accepted, "voided");
    return FollowPayment(client, id, hasLeftAuthorization, settleTimeoutMs);
  });
}
