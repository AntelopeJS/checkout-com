import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import type { JourneyContext } from "@antelopejs/tooling-configs/verify";

import { isRecord, parseJson, type Json } from "./json.ts";

/** The environment variables that point the journeys at the merchant's Checkout.com sandbox; `saas.env` of `verify.config.ts`. */
export const SANDBOX_KEYS = ["CKO_SECRET_KEY", "CKO_PUBLIC_KEY", "CKO_PROCESSING_CHANNEL_ID", "CKO_BASE_URL"];

const SANDBOX_HOST_SUFFIX = ".api.sandbox.checkout.com";
const SETTLE_BUDGET_MS = 45_000;
const SETTLE_INTERVAL_MS = 1000;
const BROWSER_BUDGET_MS = 30_000;
const BROWSER_TIMEOUT_MS = 60_000;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;

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

export interface Keys {
  secretKey: string;
  publicKey: string;
  processingChannel: string;
}

/** What Checkout.com answered: the status and the parsed body, `null` when it was empty. */
export interface Answer {
  status: number;
  json: Json;
}

/** Where a journey's Checkout.com answers, and how the journey sends to it, waits on it and plays the payer there. */
export interface Target {
  /** `sandbox` or `stand-in`: the prefix of every step a journey records on it. */
  name: string;
  /** The `baseUrl` the module is configured with. */
  base: string;
  keys: Keys;
  /** The stand-in, whose call log and levers only it has; `null` on the sandbox. */
  standIn: StandIn | null;
  /** One request as a client of Checkout.com sends it. */
  request(method: string, path: string, key: string, body?: Json): Promise<Answer>;
  /** Reads until `until` holds or the target gives up, and returns the last read for the journey's checks to judge. */
  settle(read: () => Promise<Json>, until: (value: Json) => boolean): Promise<Json>;
  /** Opens a 3-D Secure redirect as the payer's browser does. */
  openRedirect(url: string): Promise<void>;
}

export interface StandInTarget extends Target {
  standIn: StandIn;
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

async function send(base: string, method: string, path: string, key: string, body?: Json): Promise<Answer> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(new URL(path, base), init);
  return { status: response.status, json: parseJson(await response.text()) };
}

/** Starts a fresh stand-in from `dist/test/standin` and returns it as a target with its own keys. */
export async function startStandIn(repo: string): Promise<StandInTarget> {
  const loaded: unknown = await import(pathToFileURL(join(repo, "dist/test/standin/index.js")).href);
  const exported = isRecord(loaded) ? loaded : {};
  const { STAND_IN_SECRET_KEY: secretKey, STAND_IN_PUBLIC_KEY: publicKey, STAND_IN_PROCESSING_CHANNEL: processingChannel, StandIn: StandInClass } = exported;
  if (!isText(secretKey) || !isText(publicKey) || !isText(processingChannel) || !isConstructor(StandInClass)) {
    throw new Error("dist/test/standin does not export StandIn and the stand-in keys: run the build first");
  }
  const standIn: unknown = Reflect.construct(StandInClass, []);
  if (!isStandIn(standIn)) throw new Error("the stand-in does not have the members the skill drives");
  const base = await standIn.start();
  return {
    name: "stand-in",
    base,
    keys: { secretKey, publicKey, processingChannel },
    standIn,
    request: (method, path, key, body) => send(base, method, path, key, body),
    async settle(read) {
      await standIn.settled();
      return read();
    },
    async openRedirect(url) {
      const opened = await fetch(url);
      if (!opened.ok) throw new Error(`the stand-in's 3-D Secure page answered ${opened.status}`);
      await standIn.settled();
    },
  };
}

function isSandboxUrl(base: string): boolean {
  if (!URL.canParse(base)) return false;
  const url = new URL(base);
  return url.protocol === "https:" && url.hostname.endsWith(SANDBOX_HOST_SUFFIX);
}

/** The sandbox the environment names, refused unless every key is a sandbox one; a reason never repeats a key or the merchant's base URL, since it lands in the evidence. */
function sandboxFrom(context: JourneyContext): Pick<Target, "base" | "keys"> {
  const missing = SANDBOX_KEYS.filter((name) => !process.env[name]);
  if (missing.length > 0) context.notVerified(`${missing.join(", ")} missing from this journey's environment, though the run was created with every sandbox key`);
  const { CKO_SECRET_KEY: secretKey = "", CKO_PUBLIC_KEY: publicKey = "", CKO_PROCESSING_CHANNEL_ID: processingChannel = "", CKO_BASE_URL: base = "" } = process.env;
  if (!secretKey.startsWith("sk_sbox_") || !publicKey.startsWith("pk_sbox_")) {
    context.notVerified("CKO_SECRET_KEY and CKO_PUBLIC_KEY must be sandbox keys (sk_sbox_…, pk_sbox_…): the journeys never run against production");
  }
  if (!isSandboxUrl(base)) context.notVerified(`CKO_BASE_URL is not a merchant sandbox URL (https://{prefix}${SANDBOX_HOST_SUFFIX}): the journeys never run against production`);
  return { base, keys: { secretKey, publicKey, processingChannel } };
}

/**
 * The merchant's Checkout.com sandbox, from `SANDBOX_KEYS`. A sandbox that stops answering, rate-limits or fails ends the journey not verified; so does a missing `CKO_BROWSER` when the payer must open a redirect.
 * The payer's browser runs with its output discarded: the page 3-D Secure ends on is served from the merchant's base URL, which the evidence must not hold.
 */
export function sandboxTarget(context: JourneyContext): Target {
  const { base, keys } = sandboxFrom(context);
  const browser = process.env.CKO_BROWSER ?? "";
  return {
    name: "sandbox",
    base,
    keys,
    standIn: null,
    async request(method, path, key, body) {
      let answer: Answer;
      try {
        answer = await send(base, method, path, key, body);
      } catch (error) {
        const cause = isRecord(error) ? error.cause : undefined;
        const code = isRecord(cause) && isText(cause.code) ? cause.code : "no answer";
        return context.notVerified(`the Checkout.com sandbox did not answer ${method} ${path}: ${code}`);
      }
      if (answer.status === TOO_MANY_REQUESTS || answer.status >= SERVER_ERROR) context.notVerified(`the Checkout.com sandbox answered ${answer.status} to ${method} ${path}`);
      return answer;
    },
    async settle(read, until) {
      const deadline = Date.now() + SETTLE_BUDGET_MS;
      let value = await read();
      while (!until(value) && Date.now() < deadline) {
        await delay(SETTLE_INTERVAL_MS);
        value = await read();
      }
      return value;
    },
    async openRedirect(url) {
      if (browser === "") context.notVerified("CKO_BROWSER is not set: only a browser runs the sandbox's 3-D Secure page, so no payment can pass it (docs/5.testing.md)");
      const silenced = ["-c", 'exec "$0" "$@" > /dev/null 2>&1', browser, "--headless", "--disable-gpu", "--no-first-run", `--virtual-time-budget=${BROWSER_BUDGET_MS}`, "--dump-dom", url];
      const opened = await context.command("the payer's browser opens the 3-D Secure redirect", "sh", silenced, { timeoutMs: BROWSER_TIMEOUT_MS });
      if (opened.exitCode !== 0) context.notVerified(`the payer's browser (CKO_BROWSER) ended with ${opened.exitCode ?? opened.signal ?? "no exit code"}`);
    },
  };
}
