import { PaymentError } from "@antelopejs/interface-payment";
import type {
  PaymentEvent,
  PaymentEventType,
  WebhookRequest,
} from "@antelopejs/interface-payment";

import { LookUp } from "./lookup";
import { Translating } from "./errors";
import { LoadPayment } from "./follow";
import { AssertGenuine } from "./signature";
import type { CkoEventEnvelope } from "./cko-types";
import { RememberHostedSave } from "./saved-methods";
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
  const payment = await LoadPayment(account.client, data.id);
  await RememberHostedSave(
    account.client,
    data.metadata?.[SAVE_FOR_KEY],
    payment,
  );
  return { type, payment };
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
  [REFUND_EVENTS, refundEvent],
  [DISPUTE_EVENTS, disputeEvent],
];

function parseEnvelope(body: Uint8Array): CkoEventEnvelope {
  try {
    return JSON.parse(Buffer.from(body).toString("utf8")) as CkoEventEnvelope;
  } catch {
    throw new PaymentError(
      "The delivery was signed correctly but its body is not JSON",
    );
  }
}

async function buildEvent(
  account: Account,
  envelope: CkoEventEnvelope,
): Promise<PaymentEvent | undefined> {
  for (const [types, build] of BUILDERS) {
    const type = LookUp(types, envelope.type);
    if (!type) continue;
    const built = await build(account, envelope, type);
    if (!built?.type) return undefined;
    return {
      ...built,
      id: envelope.id,
      type: built.type,
      createdAt: ToEpochMillis(envelope.created_on ?? envelope.timestamp),
    };
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
  const envelope = parseEnvelope(request.body);
  return Translating(envelope.data?.id ?? "", { entity: "payment" }, () =>
    buildEvent(account, envelope),
  );
}
