import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";

import {
  type JsonObject,
  type JsonValue,
  ParseJson,
  isJsonObject,
} from "./wire";

export interface StandInRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: JsonObject;
}

export interface StandInReply {
  status: number;
  body?: JsonValue;
}

export type Handler = (
  request: StandInRequest,
  params: string[],
) => StandInReply | Promise<StandInReply>;

export interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  isIdempotent?: boolean;
  isPublic?: boolean;
}

export interface RecordedCall {
  method: string;
  path: string;
  idempotencyKey?: string;
  body: JsonObject;
  status: number;
  replayed: boolean;
}

export type Fault =
  | { kind: "status"; status: number; body?: JsonValue }
  | { kind: "drop" };

export interface StandInKeys {
  secretKey: string;
  publicKey: string;
}

interface StoredReply {
  fingerprint: string;
  reply: StandInReply;
}

const IDEMPOTENCY_HEADER = "cko-idempotency-key";
const CONFLICT = 409;
const UNPROCESSABLE = 422;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;

function fingerprint(method: string, path: string, body: JsonObject): string {
  return createHash("sha256")
    .update(`${method} ${path} ${JSON.stringify(body)}`)
    .digest("hex");
}

async function readBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? ParseJson(text) : {};
  return isJsonObject(body) ? body : {};
}

function idempotencyKeyOf(headers: IncomingHttpHeaders): string | undefined {
  const value = headers[IDEMPOTENCY_HEADER];
  return Array.isArray(value) ? value.join(", ") : value;
}

function isAddressInfo(
  address: ReturnType<Server["address"]>,
): address is AddressInfo {
  return typeof address === "object" && address !== null;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * An HTTP server that answers the slice of Checkout.com's API the module uses.
 *
 * What it answers with is decided by the routes it is given; this class owns
 * only what every endpoint shares: bearer authentication, the
 * `Cko-Idempotency-Key` cache on the endpoints Checkout.com documents it for,
 * a log of every call, and faults injected by tests.
 */
export class StandInServer {
  readonly calls: RecordedCall[] = [];
  private readonly faults: Fault[] = [];
  private readonly replies = new Map<string, StoredReply>();
  private readonly inFlight = new Set<string>();
  private server: Server | undefined;

  constructor(
    private readonly keys: StandInKeys,
    private routes: Route[],
  ) {}

  useRoutes(routes: Route[]): void {
    this.routes = routes;
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      void this.dispatch(request, response);
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address();
    if (!isAddressInfo(address)) {
      throw new Error("The stand-in is not listening on a TCP port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  injectFault(fault: Fault, times = 1): void {
    for (let index = 0; index < times; index += 1) {
      this.faults.push(fault);
    }
  }

  clearFaults(): void {
    this.faults.length = 0;
  }

  private async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const fault = this.faults.shift();
    if (fault?.kind === "drop") {
      request.socket.destroy();
      return;
    }
    const reply = fault
      ? { status: fault.status, body: fault.body }
      : await this.answer(request).catch((cause: unknown) => ({
          status: 500,
          body: { error_type: "stand_in_failure", detail: String(cause) },
        }));
    response.statusCode = reply.status;
    if (reply.body === undefined) {
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(reply.body));
  }

  private isAuthorized(request: IncomingMessage, route: Route): boolean {
    const key = route.isPublic ? this.keys.publicKey : this.keys.secretKey;
    return request.headers.authorization === `Bearer ${key}`;
  }

  private async answer(request: IncomingMessage): Promise<StandInReply> {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const body = await readBody(request);
    const call: StandInRequest = {
      method: request.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
    };
    const match = this.match(call);
    if (!match) {
      return this.record(call, { status: NOT_FOUND }, false);
    }
    const [route, params] = match;
    if (!this.isAuthorized(request, route)) {
      return this.record(call, { status: UNAUTHORIZED }, false);
    }
    if (!route.isIdempotent) {
      return this.record(call, await route.handler(call, params), false);
    }
    return this.idempotent(call, route, params);
  }

  private match(call: StandInRequest): [Route, string[]] | undefined {
    for (const route of this.routes) {
      if (route.method !== call.method) continue;
      const found = route.pattern.exec(call.path);
      if (found) return [route, found.slice(1)];
    }
    return undefined;
  }

  private async idempotent(
    call: StandInRequest,
    route: Route,
    params: string[],
  ): Promise<StandInReply> {
    const key = idempotencyKeyOf(call.headers);
    if (!key) {
      return this.record(call, await route.handler(call, params), false);
    }
    const stored = this.replies.get(key);
    const print = fingerprint(call.method, call.path, call.body);
    if (stored) {
      const reply = stored.fingerprint === print ? stored.reply : mismatch();
      return this.record(call, reply, true);
    }
    if (this.inFlight.has(key)) {
      return this.record(call, { status: CONFLICT }, true);
    }
    this.inFlight.add(key);
    try {
      const reply = await route.handler(call, params);
      if (isSuccess(reply.status)) {
        this.replies.set(key, { fingerprint: print, reply });
      }
      return this.record(call, reply, false);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private record(
    call: StandInRequest,
    reply: StandInReply,
    replayed: boolean,
  ): StandInReply {
    const key = idempotencyKeyOf(call.headers);
    const recorded: RecordedCall = {
      method: call.method,
      path: call.path,
      body: call.body,
      status: reply.status,
      replayed,
    };
    if (key) recorded.idempotencyKey = key;
    this.calls.push(recorded);
    return reply;
  }
}

function mismatch(): StandInReply {
  return {
    status: UNPROCESSABLE,
    body: {
      request_id: "stand-in",
      error_type: "request_invalid",
      error_codes: ["idempotency_key_mismatch"],
    },
  };
}
