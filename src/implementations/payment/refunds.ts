import {
  InvalidPaymentStateError,
  PaymentNotFoundError,
} from "@antelopejs/interface-payment";
import type {
  Amount,
  Refund,
  RefundReason,
  RefundRequest,
} from "@antelopejs/interface-payment";

import { Translating } from "./errors";
import { GetAccount } from "./accounts";
import { ReadActions, ReadPayment } from "./follow";
import { AssertPaymentId, ParseRefundId } from "./ids";
import type {
  CkoActionAccepted,
  CkoPayment,
  CkoRefundRequest,
} from "./cko-types";
import { REFUND_REASON_KEY, ToRefund, WriteMetadata } from "./mapping";

const REFUND_ENTITY = { entity: "payment" as const, forbiddenIsState: true };
const ALREADY_REFUNDED = 200;

function reasonMetadata(
  reason: RefundReason | undefined,
): Record<string, string> {
  return reason ? { [REFUND_REASON_KEY]: reason } : {};
}

function requestedAmount(request: RefundRequest, payment: CkoPayment): Amount {
  return (
    request.amount ?? {
      value: payment.balances?.available_to_refund ?? 0,
      currency: payment.currency ?? "",
    }
  );
}

/**
 * Checkout.com accepts a refund with a 202 and settles it later, so the result
 * is usually `pending`; the refund's own action is looked for once in case it
 * has already been processed.
 */
export async function RefundPayment(
  request: RefundRequest,
  idempotencyKey: string,
  provider?: string,
): Promise<Refund> {
  AssertPaymentId(request.payment);
  const { client } = GetAccount(provider);
  return Translating(request.payment, REFUND_ENTITY, async () => {
    const payment = await ReadPayment(client, request.payment);
    const sent: CkoRefundRequest = {
      metadata: WriteMetadata(request.metadata, reasonMetadata(request.reason)),
    };
    if (request.amount) {
      sent.amount = request.amount.value;
    }
    const accepted = await client.send<CkoActionAccepted>({
      method: "POST",
      path: `/payments/${request.payment}/refunds`,
      body: sent,
      idempotencyKey,
    });
    if (accepted.status === ALREADY_REFUNDED) {
      throw new InvalidPaymentStateError(
        "The payment is already refunded",
        undefined,
        "already_refunded",
      );
    }
    const actionId = accepted.body.action_id;
    const actions = await ReadActions(client, request.payment);
    const action = actions.find(({ id }) => id === actionId);
    return ToRefund(
      payment,
      action,
      actionId,
      requestedAmount(request, payment),
    );
  });
}

export async function GetRefund(
  id: string,
  provider?: string,
): Promise<Refund> {
  const { payment: paymentId, action: actionId } = ParseRefundId(id);
  const { client } = GetAccount(provider);
  return Translating(id, { entity: "refund" }, async () => {
    const payment = await ReadPayment(client, paymentId);
    const actions = await ReadActions(client, paymentId);
    const action = actions.find(
      (each) => each.id === actionId && each.type === "Refund",
    );
    if (!action) throw new PaymentNotFoundError(id, "refund");
    return ToRefund(payment, action, actionId);
  });
}
