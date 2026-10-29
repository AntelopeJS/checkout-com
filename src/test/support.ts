import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  CreatePayment,
  GetPayment,
  type Payment,
  type PaymentStatus,
} from "@antelopejs/interface-payment";

import { MintToken, type Target } from "./mint";
import { CurrentStandIn, type StandIn } from "./standin";

export const SUITE_TIMEOUT = 60_000;
const WAIT_TIMEOUT = 20_000;
const WAIT_INTERVAL = 100;

export function key(): string {
  return `checkout-com-suite-${randomUUID()}`;
}

export function reference(): string {
  return `suite-${randomUUID()}`;
}

export function email(): string {
  return `${randomUUID()}@merchant.invalid`;
}

/** The stand-in, or a skip when the suite runs against the sandbox. */
export function RequireStandIn(context: Mocha.Context): StandIn {
  const standIn = CurrentStandIn();
  if (!standIn) context.skip();
  return standIn;
}

export function IsLive(): boolean {
  return process.env.CKO_TEST_MODE === "live";
}

export function SuiteTarget(): Target {
  const target: Target = {
    baseUrl: process.env.CKO_TEST_BASE_URL ?? "",
    secretKey: process.env.CKO_TEST_SECRET_KEY ?? "",
    processingChannelId: process.env.CKO_TEST_PROCESSING_CHANNEL_ID ?? "",
  };
  if (process.env.CKO_TEST_PUBLIC_KEY) {
    target.publicKey = process.env.CKO_TEST_PUBLIC_KEY;
  }
  return target;
}

/** A fresh single-use card token, or a skip when there is no public key. */
export async function CardToken(
  context: Mocha.Context,
  cardNumber: string,
): Promise<string> {
  const target = SuiteTarget();
  if (!target.publicKey) context.skip();
  return MintToken(target, cardNumber);
}

/** Reads Checkout.com directly, bypassing the module, for what it hides. */
export async function ReadRaw<T>(
  path: string,
  isExpected: (body: unknown) => body is T,
): Promise<T> {
  const target = SuiteTarget();
  const response = await fetch(new URL(path, target.baseUrl), {
    headers: { Authorization: `Bearer ${target.secretKey}` },
  });
  assert.ok(response.ok, `${path} answered ${response.status}`);
  const body: unknown = await response.json();
  assert.ok(isExpected(body), `${path} answered an unexpected body`);
  return body;
}

export function Sign(body: string, signatureKey: string): string {
  return createHmac("sha256", signatureKey).update(body).digest("hex");
}

export async function WaitFor<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await delay(WAIT_INTERVAL);
    value = await read();
  }
  assert.ok(isDone(value), `${label}: last seen ${JSON.stringify(value)}`);
  return value;
}

const CHARGE = { value: 2500, currency: "EUR" };

type PaymentRequest = Parameters<typeof CreatePayment>[0];

export interface ChargeOptions {
  method?: string;
  authorizeOnly?: boolean;
  provider?: string;
  amount?: number;
}

/** An off-session charge on the suite's test method, or a skip without one. */
export async function Charge(
  context: Mocha.Context,
  options: ChargeOptions = {},
): Promise<Payment> {
  const method = options.method ?? process.env.ANTELOPE_PAYMENT_TEST_METHOD;
  if (!method) context.skip();
  const request: PaymentRequest = {
    amount: { ...CHARGE, value: options.amount ?? CHARGE.value },
    reference: reference(),
    paymentMethod: method,
    offSession: true,
  };
  if (options.authorizeOnly) request.authorizeOnly = true;
  return CreatePayment(request, key(), options.provider);
}

export function Settled(id: string, status: PaymentStatus): Promise<Payment> {
  return WaitFor(
    () => GetPayment(id),
    (payment) => payment.status === status,
    `payment ${id} reaches ${status}`,
  );
}
