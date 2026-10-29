import type { JsonValue } from "./cko-types";

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

async function readBody(response: Response): Promise<JsonValue | undefined> {
  if (response.status === NO_CONTENT) {
    return undefined;
  }
  const text = await response.text().catch((cause: unknown) => {
    throw new CkoTransportError(failureReason(cause));
  });
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error_type: "unparseable_response" };
  }
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

  async send<T>(request: CkoRequest): Promise<CkoResponse<T>> {
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
      throw new CkoApiError(response.status, (body ?? {}) as CkoErrorBody);
    }
    return { status: response.status, body: body as T };
  }
}
