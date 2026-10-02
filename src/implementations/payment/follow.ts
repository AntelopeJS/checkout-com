import { setTimeout as delay } from "node:timers/promises";
import type { Payment } from "@antelopejs/interface-payment";

import type { CkoClient } from "./http";
import type { CkoAction, CkoPayment } from "./cko-types";
import { ToFailure, ToPayment, type PaymentContext } from "./mapping";

const POLL_INTERVAL_MS = 200;
const DECLINED = "Declined";
const AUTHORIZATION_ACTIONS = new Set(["Authorization", "Card Verification"]);

export function ReadPayment(
  client: CkoClient,
  id: string,
): Promise<CkoPayment> {
  return client
    .send<CkoPayment>({ method: "GET", path: `/payments/${id}` })
    .then(({ body }) => body);
}

export function ReadActions(
  client: CkoClient,
  id: string,
): Promise<CkoAction[]> {
  return client
    .send<CkoAction[]>({ method: "GET", path: `/payments/${id}/actions` })
    .then(({ body }) => body ?? []);
}

/**
 * `GET /payments/{id}` carries no response code, so a declined payment's
 * reason is read from its authorization action.
 */
async function declineContext(
  client: CkoClient,
  payment: CkoPayment,
): Promise<PaymentContext> {
  if (payment.status !== DECLINED) return {};
  const actions = await ReadActions(client, payment.id);
  const authorization = actions.find(({ type }) =>
    AUTHORIZATION_ACTIONS.has(type),
  );
  return authorization
    ? {
        failure: ToFailure(
          authorization.response_code,
          authorization.response_summary,
        ),
      }
    : {};
}

export async function LoadPayment(
  client: CkoClient,
  id: string,
): Promise<Payment> {
  const payment = await ReadPayment(client, id);
  return ToPayment(payment, await declineContext(client, payment));
}

/**
 * Captures, voids and refunds are accepted with a 202 and applied later. The
 * contract answers with the payment after the action, so the payment is read
 * until the action shows or the budget runs out; in the second case the
 * payment is returned as Checkout.com last reported it.
 */
export async function FollowPayment(
  client: CkoClient,
  id: string,
  isApplied: (payment: CkoPayment) => boolean,
  timeoutMs: number,
): Promise<Payment> {
  const deadline = Date.now() + timeoutMs;
  let payment = await ReadPayment(client, id);
  while (!isApplied(payment) && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    payment = await ReadPayment(client, id);
  }
  return ToPayment(payment, await declineContext(client, payment));
}
