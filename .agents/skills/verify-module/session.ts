import { createHmac } from "node:crypto";

import { equal, type App, type CallResult, type Check, type JourneyContext } from "@antelopejs/tooling-configs/verify";

import { canonical, isNumber, isRecord, isString, parseJson, pick, text, tuple, type Json } from "./json.ts";
import { sandboxTarget, startStandIn, type Keys, type StandIn, type StandInTarget, type Target } from "./targets.ts";

export { pick, text, tuple, type Json } from "./json.ts";
export type ModuleConfig = NonNullable<NonNullable<Parameters<JourneyContext["fixture"]>[0]>["moduleConfig"]>;

export const WEBHOOK_KEY = "verify-signature-key";
export const SECONDARY_WEBHOOK_KEY = "verify-secondary-signature-key";
export const SECONDARY_AUTHORIZATION = "verify-secondary-authorization";
export const BILLING_COUNTRY = "FR";

export const CARDS = {
  approved: "4485040371536584",
  insufficientFunds: "4544249167673670",
  challenge: "4010061700000021",
} as const;

export const EUR = { value: 2500, currency: "EUR" } as const;

/** A well-formed customer id that names no customer. The sandbox refuses the all-zero id as an invalid request (422) instead of answering 404. */
export const UNKNOWN_CUSTOMER = "cus_aaaaaaaaaaaaaaaaaaaaaaaaaa";

/** One call the stand-in answered, as it recorded it. */
export interface RecordedCall {
  method: string;
  path: string;
  idempotencyKey: string | null;
  body: Json;
  status: number;
  replayed: boolean;
}

function toCall(entry: Json): RecordedCall | null {
  const method = pick(entry, "method");
  const path = pick(entry, "path");
  const status = pick(entry, "status");
  if (!isString(method) || !isString(path) || !isNumber(status)) return null;
  const idempotencyKey = pick(entry, "idempotencyKey");
  return { method, path, idempotencyKey: isString(idempotencyKey) ? idempotencyKey : null, body: pick(entry, "body") ?? null, status, replayed: pick(entry, "replayed") === true };
}

/** The calls to one endpoint the stand-in has answered so far, oldest first. */
export function callsTo(standIn: StandIn, method: string, path: string): RecordedCall[] {
  return standIn.calls.flatMap((entry) => {
    const call = toCall(parseJson(JSON.stringify(entry)));
    return call !== null && call.method === method && call.path === path ? [call] : [];
  });
}

/** The module loaded in `ajs project dev`, pointed at one target. */
export interface Session {
  context: JourneyContext;
  app: App;
  target: Target;
}

/** A session on the stand-in, for a journey that pulls one of its levers: the payer's side of a challenge or a hosted page, or a refusal the sandbox does not make. */
export interface StandInSession extends Session {
  target: StandInTarget;
}

function accountConfig(base: string, keys: Keys): ModuleConfig {
  return { secretKey: keys.secretKey, processingChannelId: keys.processingChannel, baseUrl: base };
}

/** The module config for a session: the default account, and a `secondary` one with the same keys, `Unscheduled` charges and its own webhook key and required authorization. */
export function sessionConfig(base: string, keys: Keys, overrides: ModuleConfig = {}): ModuleConfig {
  return {
    ...accountConfig(base, keys),
    webhookSignatureKey: WEBHOOK_KEY,
    checkoutBillingCountry: BILLING_COUNTRY,
    accounts: {
      secondary: {
        ...accountConfig(base, keys),
        webhookSignatureKey: SECONDARY_WEBHOOK_KEY,
        webhookAuthorization: SECONDARY_AUTHORIZATION,
        merchantInitiatedType: "Unscheduled",
      },
    },
    ...overrides,
  };
}

function startApp(context: JourneyContext, target: Target, overrides: ModuleConfig): Promise<App> {
  const project = context.fixture({ moduleConfig: sessionConfig(target.base, target.keys, overrides) });
  return context.dev(`ajs-project-dev on the ${target.name}`, project);
}

/** Starts a fresh stand-in, loads the module against it and hands both to `run`. */
export async function onStandIn(context: JourneyContext, run: (session: StandInSession) => Promise<void>, overrides: ModuleConfig = {}): Promise<void> {
  const target = await startStandIn(context.repo);
  try {
    await run({ context, app: await startApp(context, target, overrides), target });
  } finally {
    await target.standIn.stop();
  }
}

/** Runs `run` against the merchant's Checkout.com sandbox, then again against a fresh stand-in, whose log answers the checks of what the module sent that the sandbox cannot show. */
export async function onSandboxAndStandIn(context: JourneyContext, run: (session: Session) => Promise<void>, overrides: ModuleConfig = {}): Promise<void> {
  const sandbox = sandboxTarget(context);
  await run({ context, app: await startApp(context, sandbox, overrides), target: sandbox });
  await onStandIn(context, run, overrides);
}

/** Calls an interface function through core, as a step named after the target and `name`. */
export function call(session: Session, name: string, path: string, args: Json[]): Promise<CallResult> {
  return session.context.call(`${session.target.name}: ${name}`, session.app, { path: [path], args });
}

/** Checks of what the module sent. Only the stand-in logs requests, so `fromLog` judges them there; on the sandbox `atSandbox` reads Checkout.com's own view of the same fact, and a fact the sandbox does not show is left to the stand-in pass. */
export async function sent(session: Session, fromLog: (target: StandInTarget) => Check[], atSandbox: () => Promise<Check[]> = () => Promise.resolve([])): Promise<Check[]> {
  const { target } = session;
  return target.standIn === null ? atSandbox() : fromLog({ ...target, standIn: target.standIn });
}

/** What the stand-in recorded of the one payment request a journey sent with `reference`: the only `POST /payments`, answered 201 or 202 (it answers 401 to any key but its secret key), and a JSON object carrying the amount, currency, reference and the configured processing channel. */
export function acceptedPaymentRequest(target: StandInTarget, reference: string): Check[] {
  const posted = callsTo(target.standIn, "POST", "/payments");
  const body = posted[0]?.body;
  return [
    same("the stand-in this run configured as baseUrl recorded exactly one payment request", posted.length, 1),
    same("it answered 201 or 202, which only the configured secret key earns", [201, 202].includes(posted[0]?.status ?? 0), true),
    same("the request body is a JSON object", isRecord(body), true),
    same(
      "it carries the amount, currency, reference and the configured processing channel",
      [pick(body, "amount"), pick(body, "currency"), pick(body, "reference"), pick(body, "processing_channel_id")],
      [EUR.value, EUR.currency, reference, target.keys.processingChannel],
    ),
  ];
}

let counter = 0;

/** A fresh idempotency key or reference, unique within the process. */
export function fresh(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

/** The name and message of the error a call threw, or `null` when it returned. */
export function thrown(result: CallResult): Json {
  return [pick(result.json, "error", "name") ?? null, pick(result.json, "error", "message") ?? null];
}

export function answered(result: CallResult): Check {
  return { name: "the call through core answered", pass: result.ok, detail: result.ok ? "ok" : `${result.body}` };
}

/** `equal` that ignores key order; an absent value, also inside an array, reads as `null`. */
export function same(name: string, actual: Json | undefined | (Json | undefined)[], expected: Json | undefined): Check {
  return equal(name, canonical(Array.isArray(actual) ? tuple(...actual) : actual), canonical(expected));
}

/** A single-use card token, minted with the public key as the payer's browser would. */
export async function mintToken(session: Session, cardNumber: string): Promise<string> {
  const { target } = session;
  const minted = await target.request("POST", "/tokens", target.keys.publicKey, { type: "card", number: cardNumber, expiry_month: 12, expiry_year: new Date().getFullYear() + 3, cvv: "100" });
  const token = pick(minted.json, "token");
  return isString(token) ? token : session.context.notVerified(`the ${target.name} minted no token for a test card: it answered ${minted.status}`);
}

/** What Checkout.com holds for a payment, read with the secret key and not through the module. */
export async function paymentAtProvider(session: Session, id: string): Promise<Json> {
  return (await session.target.request("GET", `/payments/${id}`, session.target.keys.secretKey)).json;
}

/** What Checkout.com holds for a customer, read with the secret key and not through the module. */
export async function customerAtProvider(session: Session, id: string): Promise<Json> {
  return (await session.target.request("GET", `/customers/${id}`, session.target.keys.secretKey)).json;
}

/** A provider payment's `status` is `status`. */
export function statusIs(status: string): (held: Json) => boolean {
  return (held) => pick(held, "status") === status;
}

/** The payment as Checkout.com holds it once `until` holds: the stand-in applies what it accepted at once, the sandbox is read until it shows or the target's budget runs out. */
export function settled(session: Session, id: string, until: (held: Json) => boolean): Promise<Json> {
  return session.target.settle(() => paymentAtProvider(session, id), until);
}

/** How `pay` differs from its defaults: request fields, the idempotency key and the account. */
export interface PayOptions {
  request?: Record<string, Json>;
  key?: string;
  provider?: string;
}

/** `CreatePayment` on a fresh token of `card`, with `options.request` replacing the defaults. */
export async function pay(session: Session, name: string, card: string, options: PayOptions = {}): Promise<CallResult> {
  const token = await mintToken(session, card);
  const request = { amount: EUR, reference: fresh("ref"), paymentMethod: token, ...options.request };
  return call(session, name, "CreatePayment", [request, options.key ?? fresh("key"), options.provider ?? null]);
}

/** A delivery as `VerifyWebhook` takes it. */
export type Delivery = { body: string; headers: { [name: string]: string } };

/** The delivery Checkout.com's workflow would send: the raw body (a string, the JSON driver cannot carry bytes) and its `Cko-Signature` header. */
export function delivery(type: string, data: Record<string, Json>, signatureKey: string = WEBHOOK_KEY): Delivery {
  const body = JSON.stringify({ id: fresh("evt"), type, timestamp: new Date().toISOString(), data });
  return { body, headers: { "cko-signature": createHmac("sha256", signatureKey).update(body).digest("hex"), "content-type": "application/json" } };
}

export const RETURN_URL = "https://merchant.invalid/return";

const PAST_AUTHENTICATION_AND_CAPTURE = new Set(["Pending", "Authorized"]);

/** The payer's browser opening a payment's 3-D Secure redirect, which authenticates a frictionless card; then `GetPayment` once Checkout.com holds the payment past authentication and the capture that follows. */
export async function passRedirect(session: Session, name: string, payment: CallResult): Promise<CallResult> {
  const id = text(pick(payment.value, "id"));
  await session.target.openRedirect(text(pick(payment.value, "redirectUrl")));
  await settled(session, id, (held) => !PAST_AUTHENTICATION_AND_CAPTURE.has(text(pick(held, "status"))));
  return call(session, name, "GetPayment", [id]);
}

/** A payment that Checkout.com challenges with 3-D Secure: a saving payment on the challenge card, for a new customer, which asks for the mandate. */
export async function challenged(session: Session, name: string): Promise<CallResult> {
  const customer = await call(session, `CreateCustomer for ${name}`, "CreateCustomer", [{ email: `${fresh("payer")}@merchant.invalid` }, fresh("key"), null]);
  return pay(session, name, CARDS.challenge, { request: { customer: text(pick(customer.value, "id")), savePaymentMethod: true, returnUrl: RETURN_URL } });
}
