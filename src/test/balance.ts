import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { Target } from "./mint";
import { CkoClient } from "../implementations/payment/http";
import {
  IsCkoActions,
  IsCkoPayment,
} from "../implementations/payment/resources";

const PROBE_AMOUNT = 100;
const POLL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const PROBE_BUDGET_MS = 45_000;
const NO_BALANCE = "50003";
const CAPTURED = "Captured";

/** Why the refund tests do not run live, when a probe showed they cannot pass. */
export const REFUNDS_BLOCKED_REASON =
  "not verified live: sandbox balance (50003)";

async function poll<T>(
  read: () => Promise<T | undefined>,
  deadline: number,
): Promise<T | undefined> {
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(POLL_MS);
  }
  return undefined;
}

async function capturedCharge(
  client: CkoClient,
  target: Target,
  instrument: string,
  deadline: number,
): Promise<string | undefined> {
  const { body: payment } = await client.send(
    {
      method: "POST",
      path: "/payments",
      idempotencyKey: randomUUID(),
      body: {
        source: { type: "id", id: instrument },
        amount: PROBE_AMOUNT,
        currency: "EUR",
        reference: `refund-balance-probe-${randomUUID()}`,
        processing_channel_id: target.processingChannelId,
        merchant_initiated: true,
        payment_type: "Unscheduled",
      },
    },
    IsCkoPayment,
  );
  return poll(async () => {
    const { body } = await client.send(
      { method: "GET", path: `/payments/${payment.id}` },
      IsCkoPayment,
    );
    return body.status === CAPTURED ? body.id : undefined;
  }, deadline);
}

/**
 * Refunds a fresh charge of `instrument` and reports whether the sandbox
 * refused it for want of balance. Every sandbox refund then fails with 50003
 * after its 202, so no refund test could pass; any other outcome, an
 * inconclusive one included, leaves the refund tests to run and say so
 * themselves.
 */
export async function RefundsBlocked(
  target: Target,
  instrument: string,
): Promise<boolean> {
  const client = new CkoClient({
    baseUrl: target.baseUrl,
    secretKey: target.secretKey,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const deadline = Date.now() + PROBE_BUDGET_MS;
  const payment = await capturedCharge(client, target, instrument, deadline);
  if (!payment) return false;
  await client.execute({
    method: "POST",
    path: `/payments/${payment}/refunds`,
    idempotencyKey: randomUUID(),
    body: { amount: PROBE_AMOUNT },
  });
  const code = await poll(async () => {
    const { body } = await client.send(
      { method: "GET", path: `/payments/${payment}/actions` },
      IsCkoActions,
    );
    const refund = (body ?? []).find(({ type }) => type === "Refund");
    return refund?.response_code === undefined
      ? undefined
      : String(refund.response_code);
  }, deadline);
  return code === NO_BALANCE;
}
