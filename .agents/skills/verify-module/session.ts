import { createHmac } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  equal,
  type App,
  type CallResult,
  type Check,
  type JourneyContext,
} from "@antelopejs/tooling-configs/verify";

import { canonical, isNumber, isRecord, isString, parseJson, pick, text, tuple, type Json } from "./json.ts";

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

/** One call the stand-in answered, as it recorded it. */
export interface RecordedCall {
  method: string;
  path: string;
  idempotencyKey: string | null;
  body: Json;
  status: number;
  replayed: boolean;
}

/** The stand-in for Checkout.com's API that the module's own suite uses (`src/test/standin`), as the built suite exports it. */
export interface StandIn {
  start(): Promise<string>;
  stop(): Promise<void>;
  settled(): Promise<void>;
  completeChallenge(paymentId: string, isAuthenticated: boolean): void;
  refuseNextRefund(): void;
  payHostedPage(sessionId: string, cardNumber: string): string;
  readonly calls: readonly object[];
}

function isStandIn(value: unknown): value is StandIn {
  return (
    isRecord(value) &&
    typeof value.start === "function" &&
    typeof value.stop === "function" &&
    typeof value.settled === "function" &&
    typeof value.completeChallenge === "function" &&
    typeof value.refuseNextRefund === "function" &&
    typeof value.payHostedPage === "function" &&
    Array.isArray(value.calls)
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isConstructor(value: unknown): value is new () => object {
  return typeof value === "function";
}

export interface Keys {
  secretKey: string;
  publicKey: string;
  processingChannel: string;
}

async function loadStandIn(repo: string): Promise<{ standIn: StandIn; keys: Keys }> {
  const loaded: unknown = await import(pathToFileURL(join(repo, "dist/test/standin/index.js")).href);
  const exported = isRecord(loaded) ? loaded : {};
  const { STAND_IN_SECRET_KEY: secretKey, STAND_IN_PUBLIC_KEY: publicKey, STAND_IN_PROCESSING_CHANNEL: processingChannel, StandIn: StandInClass } = exported;
  if (!isText(secretKey) || !isText(publicKey) || !isText(processingChannel) || !isConstructor(StandInClass)) {
    throw new Error("dist/test/standin does not export StandIn and the stand-in keys: run the build first");
  }
  const instance: unknown = Reflect.construct(StandInClass, []);
  if (!isStandIn(instance)) throw new Error("the stand-in does not have the members the skill drives");
  return { standIn: instance, keys: { secretKey, publicKey, processingChannel } };
}

function toCall(entry: Json): RecordedCall | null {
  const method = pick(entry, "method");
  const path = pick(entry, "path");
  const status = pick(entry, "status");
  if (!isString(method) || !isString(path) || !isNumber(status)) return null;
  const idempotencyKey = pick(entry, "idempotencyKey");
  return { method, path, idempotencyKey: isString(idempotencyKey) ? idempotencyKey : null, body: pick(entry, "body") ?? null, status, replayed: pick(entry, "replayed") === true };
}

/** The calls the stand-in has answered so far, oldest first. */
export function callsOf(standIn: StandIn): RecordedCall[] {
  return standIn.calls.flatMap((entry) => {
    const call = toCall(parseJson(JSON.stringify(entry)));
    return call === null ? [] : [call];
  });
}

/** The calls to one endpoint, oldest first. */
export function callsTo(standIn: StandIn, method: string, path: string): RecordedCall[] {
  return callsOf(standIn).filter((call) => call.method === method && call.path === path);
}

export interface Session {
  context: JourneyContext;
  app: App;
  standIn: StandIn;
  base: string;
  keys: Keys;
}

function accountConfig(base: string, keys: Keys): ModuleConfig {
  return { secretKey: keys.secretKey, processingChannelId: keys.processingChannel, baseUrl: base };
}

/** The module config for a session: the default account, and a `secondary` one with its own keys, `Unscheduled` charges and a required webhook authorization. */
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

/** Starts the stand-in, loads the module in `ajs project dev` with its `baseUrl` and keys, and hands both to `run`. */
export async function withSession(context: JourneyContext, run: (session: Session) => Promise<void>, overrides: ModuleConfig = {}): Promise<void> {
  const { standIn, keys } = await loadStandIn(context.repo);
  const base = await standIn.start();
  try {
    const project = context.fixture({ moduleConfig: sessionConfig(base, keys, overrides) });
    const app = await context.dev("ajs-project-dev", project);
    await run({ context, app, standIn, base, keys });
  } finally {
    await standIn.stop();
  }
}

export function call(session: Session, name: string, path: string, args: Json[]): Promise<CallResult> {
  return session.context.call(name, session.app, { path: [path], args });
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

/** One request to the stand-in as a client of Checkout.com would send it; the answer is parsed JSON, or `null` when the body is empty. */
export async function wire(base: string, method: string, path: string, key: string, body?: Json): Promise<{ status: number; json: Json }> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(new URL(path, base), init);
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : parseJson(text) };
}

/** A single-use card token, minted with the public key as the payer's browser would. */
export async function mintToken(session: Session, cardNumber: string): Promise<string> {
  const minted = await wire(session.base, "POST", "/tokens", session.keys.publicKey, {
    type: "card",
    number: cardNumber,
    expiry_month: 12,
    expiry_year: new Date().getFullYear() + 3,
    cvv: "100",
  });
  const token = pick(minted.json, "token");
  if (!isString(token)) throw new Error(`the stand-in minted no token: ${JSON.stringify(minted.json)}`);
  return token;
}

/** What the stand-in holds for a payment, read with the secret key and not through the module. */
export async function paymentAtProvider(session: Session, id: string): Promise<Json> {
  return (await wire(session.base, "GET", `/payments/${id}`, session.keys.secretKey)).json;
}

/** What the stand-in holds for a customer, read with the secret key and not through the module. */
export async function customerAtProvider(session: Session, id: string): Promise<Json> {
  return (await wire(session.base, "GET", `/customers/${id}`, session.keys.secretKey)).json;
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

/** A payment that Checkout.com challenges with 3-D Secure: a saving payment on the challenge card, for a new customer, which asks for the mandate. */
export async function challenged(session: Session, name: string): Promise<CallResult> {
  const customer = await call(session, `CreateCustomer for ${name}`, "CreateCustomer", [{ email: `${fresh("payer")}@merchant.invalid` }, fresh("key"), null]);
  return pay(session, name, CARDS.challenge, { request: { customer: text(pick(customer.value, "id")), savePaymentMethod: true, returnUrl: RETURN_URL } });
}
