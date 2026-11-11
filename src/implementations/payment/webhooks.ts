import { IsCkoDelivery, IsCkoEventEnvelope } from "./resources";
import { ParseJson } from "./json";
import { PaymentError } from "@antelopejs/interface-payment";
import type {
  PaymentEvent,
  PaymentEventType,
  PaymentStatus,
  WebhookRequest,
} from "@antelopejs/interface-payment";

import { LookUp } from "./lookup";
import { Translating } from "./errors";
import { LoadPayment } from "./follow";
import { AssertGenuine } from "./signature";
import type { CkoDelivery, CkoEventEnvelope, JsonValue } from "./cko-types";
import { type Account, GetAccount } from "./accounts";
import {
  AUTOMATIC_CAPTURE,
  CAPTURE_KEY,
  SAVE_FOR_KEY,
  ToDispute,
  ToEpochMillis,
  ToRefund,
} from "./mapping";

const APPROVED = "payment_approved";
const REFUNDED = "payment_refunded";

const PAYMENT_EVENTS = {
  [APPROVED]: "payment.authorized",
  payment_canceled: "payment.canceled",
  payment_captured: "payment.succeeded",
  payment_declined: "payment.failed",
  payment_expired: "payment.canceled",
  payment_paid: "payment.succeeded",
  payment_pending: "payment.pending",
  payment_voided: "payment.canceled",
} satisfies Record<string, PaymentEventType>;

/**
 * Actions Checkout.com refused after accepting them, and an authentication
 * that failed. They change nothing or end the payment, so the event says what
 * the payment read back now is: a declined capture or void leaves the hold
 * `authorized`, a failed authentication leaves it `failed`. The value here is
 * the kind of record, the type comes from {@link EVENT_BY_STATUS}.
 */
const OUTCOME_EVENTS = {
  payment_authentication_failed: "payment.failed",
  payment_capture_declined: "payment.authorized",
  payment_void_declined: "payment.authorized",
} satisfies Record<string, PaymentEventType>;

const EVENT_BY_STATUS = {
  authorized: "payment.authorized",
  canceled: "payment.canceled",
  failed: "payment.failed",
  pending: "payment.pending",
  requires_action: "payment.pending",
  succeeded: "payment.succeeded",
} satisfies Record<PaymentStatus, PaymentEventType>;

const REFUND_EVENTS = {
  [REFUNDED]: "refund.succeeded",
  payment_refund_declined: "refund.failed",
} satisfies Record<string, PaymentEventType>;

const DISPUTE_EVENTS = {
  dispute_received: "dispute.opened",
} satisfies Record<string, PaymentEventType>;

type EventBuilder = (
  account: Account,
  envelope: CkoEventEnvelope,
  type: PaymentEventType,
) => Promise<Partial<PaymentEvent> | undefined>;

/**
 * An approval Checkout.com will capture by itself is not a hold the backend
 * must act on; the capture's own event follows. Only an approval this module
 * did not mark for automatic capture is reported as `payment.authorized`.
 */
function isAutomaticApproval(envelope: CkoEventEnvelope): boolean {
  const { data } = envelope;
  return (
    envelope.type === APPROVED &&
    data.metadata?.[CAPTURE_KEY] === AUTOMATIC_CAPTURE
  );
}

/**
 * A payment event's body carries the action, not the payment: no creation
 * time, and balances only on some types. The payment is therefore read back
 * from the API and reported as it is when the delivery is handled, which may
 * be later than the moment the event describes.
 */
const paymentEvent: EventBuilder = async (account, envelope, type) => {
  if (isAutomaticApproval(envelope)) return undefined;
  const { data } = envelope;
  const payment = await LoadPayment(
    account.client,
    data.id,
    data.metadata?.[SAVE_FOR_KEY],
  );
  return { type, payment };
};

const outcomeEvent: EventBuilder = async (account, envelope) => {
  const payment = await LoadPayment(account.client, envelope.data.id);
  return { type: EVENT_BY_STATUS[payment.status], payment };
};

const refundEvent: EventBuilder = (_account, envelope, type) => {
  const { data } = envelope;
  const refund = ToRefund(
    { id: data.id, status: "", currency: data.currency },
    {
      id: data.action_id ?? "",
      type: "Refund",
      amount: data.amount ?? 0,
      approved: envelope.type === REFUNDED,
      response_code: data.response_code ?? "",
      response_summary: data.response_summary,
      processed_on: data.processed_on ?? "",
    },
    data.action_id ?? "",
  );
  return Promise.resolve({ type, refund });
};

const disputeEvent: EventBuilder = (_account, envelope, type) => {
  const { data } = envelope;
  return Promise.resolve({
    type,
    dispute: ToDispute(data, envelope.created_on ?? envelope.timestamp),
  });
};

const BUILDERS: [Record<string, PaymentEventType>, EventBuilder][] = [
  [PAYMENT_EVENTS, paymentEvent],
  [OUTCOME_EVENTS, outcomeEvent],
  [REFUND_EVENTS, refundEvent],
  [DISPUTE_EVENTS, disputeEvent],
];

function parseDelivery(body: Uint8Array): CkoDelivery {
  let parsed: JsonValue;
  try {
    parsed = ParseJson(Buffer.from(body).toString("utf8"));
  } catch {
    throw new PaymentError(
      "The delivery was signed correctly but its body is not JSON",
    );
  }
  if (!IsCkoDelivery(parsed)) {
    throw new PaymentError(
      "The delivery was signed correctly but its body is not an event",
    );
  }
  return parsed;
}

function readEnvelope(delivery: CkoDelivery): CkoEventEnvelope {
  if (!IsCkoEventEnvelope(delivery)) {
    throw new PaymentError(
      `The delivery was signed correctly but its body is not a ${delivery.type} event`,
    );
  }
  return delivery;
}

async function buildEvent(
  account: Account,
  delivery: CkoDelivery,
): Promise<PaymentEvent | undefined> {
  for (const [types, build] of BUILDERS) {
    const type = LookUp(types, delivery.type);
    if (!type) continue;
    const envelope = readEnvelope(delivery);
    return Translating(envelope.data.id, { entity: "payment" }, async () => {
      const built = await build(account, envelope, type);
      if (!built?.type) return undefined;
      return {
        ...built,
        id: envelope.id,
        type: built.type,
        createdAt: ToEpochMillis(envelope.created_on ?? envelope.timestamp),
      };
    });
  }
  return undefined;
}

/**
 * Checkout.com signs the raw body, so once the signature checks out the body
 * is authentic and the event type, refund and dispute are read from it. The
 * payment of a payment event is read back from the API, which is equally
 * authenticated.
 */
export async function VerifyWebhook(
  request: WebhookRequest,
  provider?: string,
): Promise<PaymentEvent | undefined> {
  const account = GetAccount(provider);
  AssertGenuine(
    request,
    account.webhookSignatureKey,
    account.webhookAuthorization,
  );
  return buildEvent(account, parseDelivery(request.body));
}
