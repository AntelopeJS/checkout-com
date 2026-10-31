import type { JsonValue } from "./cko-types";
import { type Guard, IsText, ListOf } from "./guards";
import { ParseJson } from "./json";

type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST";

export interface CkoRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface CkoResponse<T> {
  status: number;
  body: T;
}

export interface ClientSettings {
  baseUrl: string;
  secretKey: string;
  timeoutMs: number;
}

export interface CkoErrorBody {
  request_id?: string;
  error_type?: string;
  error_codes?: string[];
}

const IDEMPOTENCY_HEADER = "Cko-Idempotency-Key";
const NO_CONTENT = 204;
const UNPARSEABLE = "unparseable_response";
const IsTextList = ListOf(IsText);

type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorBodyOf(body: JsonValue): CkoErrorBody {
  if (!isJsonObject(body)) return {};
  const decoded: CkoErrorBody = {};
  const { request_id, error_type, error_codes } = body;
  if (IsText(request_id)) decoded.request_id = request_id;
  if (IsText(error_type)) decoded.error_type = error_type;
  if (IsTextList(error_codes)) decoded.error_codes = error_codes;
  return decoded;
}

/**
 * Checkout.com answered, and the answer was not a success.
 */
export class CkoApiError extends Error {
  readonly errorType?: string;
  readonly errorCodes: string[];
  readonly requestId?: string;

  constructor(
    readonly status: number,
    body: CkoErrorBody,
  ) {
    super(
      `Checkout.com answered ${status}${body.error_type ? ` ${body.error_type}` : ""}${body.error_codes?.length ? `: ${body.error_codes.join(", ")}` : ""}`,
    );
    this.name = "CkoApiError";
    this.errorType = body.error_type;
    this.errorCodes = body.error_codes ?? [];
    this.requestId = body.request_id;
  }
}

/**
 * Checkout.com could not be reached, or did not answer in time.
 */
export class CkoTransportError extends Error {
  constructor(reason: string) {
    super(`Checkout.com could not be reached: ${reason}`);
    this.name = "CkoTransportError";
  }
}

type CkoHeaders = {
  Authorization: string;
  Accept: string;
  "Content-Type"?: string;
  [IDEMPOTENCY_HEADER]?: string;
};

function headers(secretKey: string, request: CkoRequest): CkoHeaders {
  const sent: CkoHeaders = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json",
  };
  if (request.body !== undefined) {
    sent["Content-Type"] = "application/json";
  }
  if (request.idempotencyKey) {
    sent[IDEMPOTENCY_HEADER] = request.idempotencyKey;
  }
  return sent;
}

function failureReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type ReadBody =
  | { kind: "json"; value: JsonValue }
  | { kind: "empty" }
  | { kind: "unparseable" };

async function readBody(response: Response): Promise<ReadBody> {
  if (response.status === NO_CONTENT) {
    return { kind: "empty" };
  }
  const text = await response.text().catch((cause: unknown) => {
    throw new CkoTransportError(failureReason(cause));
  });
  if (!text) {
    return { kind: "empty" };
  }
  try {
    return { kind: "json", value: ParseJson(text) };
  } catch {
    return { kind: "unparseable" };
  }
}

function errorOf(status: number, body: ReadBody): CkoApiError {
  if (body.kind === "unparseable") {
    return new CkoApiError(status, { error_type: UNPARSEABLE });
  }
  return new CkoApiError(
    status,
    body.kind === "json" ? errorBodyOf(body.value) : {},
  );
}

/**
 * The one place this module talks HTTP. Everything Checkout.com-specific above
 * it is mapping; everything below it is `fetch`.
 */
export class CkoClient {
  constructor(private readonly settings: ClientSettings) {}

  get baseUrl(): string {
    return this.settings.baseUrl;
  }

  private async answer(
    request: CkoRequest,
  ): Promise<{ status: number; body: ReadBody }> {
    const response = await fetch(new URL(request.path, this.settings.baseUrl), {
      method: request.method,
      headers: headers(this.settings.secretKey, request),
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.settings.timeoutMs),
    }).catch((cause: unknown) => {
      throw new CkoTransportError(failureReason(cause));
    });
    const body = await readBody(response);
    if (!response.ok) {
      throw errorOf(response.status, body);
    }
    return { status: response.status, body };
  }

  /** Sends `request` and reads the answer as `T`; refuses a 2xx whose body is empty, not JSON, or not a `T`. */
  async send<T>(
    request: CkoRequest,
    isAnswer: Guard<T>,
  ): Promise<CkoResponse<T>> {
    const { status, body } = await this.answer(request);
    if (body.kind !== "json") {
      throw new CkoApiError(status, {
        error_type: body.kind === "empty" ? "empty_response" : UNPARSEABLE,
      });
    }
    if (!isAnswer(body.value)) {
      throw new CkoApiError(status, { error_type: "unexpected_response" });
    }
    return { status, body: body.value };
  }

  /** Sends `request` for its effect only: any 2xx is a success, whatever its body. */
  async execute(request: CkoRequest): Promise<void> {
    await this.answer(request);
  }
}
