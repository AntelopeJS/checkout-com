/** The JSON the module sends and the model answers, decoded at the model's edge. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Metadata = Record<string, string>;

/** Every field of a request body the model reads. */
export interface Body {
  email?: string;
  metadata?: Metadata;
  customer?: { id: string };
  source?: { type: string; id?: string };
  merchant_initiated?: boolean;
  previous_payment_id?: string;
}

/** A request this model does not answer or cannot read: the model is out of date, not the module wrong. */
export class ModelGap extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelGap";
  }
}

type Guard<T> = (value: unknown) => value is T;

type Fields<T> = { [K in keyof T]-?: Guard<T[K]> };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function IsText(value: unknown): value is string {
  return typeof value === "string";
}

function isFlag(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Whether a `fetch` target is the `URL` the module's client always passes. */
export function IsUrl(value: unknown): value is URL {
  return value instanceof URL;
}

/** Whether a thrown value is a {@link ModelGap}, which the module may have caught and hidden. */
export function IsModelGap(value: unknown): value is ModelGap {
  return value instanceof ModelGap;
}

/** Whether a thrown value is an `Error`, whose stack the check prints. */
export function IsError(value: unknown): value is Error {
  return value instanceof Error;
}

function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

function recordOf<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (value): value is Record<string, T> =>
    isObject(value) && Object.values(value).every((item) => guard(item));
}

function objectWith<T>(fields: Fields<T>): Guard<T> {
  return (value): value is T => {
    if (!isObject(value)) return false;
    for (const key in fields) {
      const field = Object.hasOwn(value, key) ? value[key] : undefined;
      if (!fields[key](field)) return false;
    }
    return true;
  };
}

const isBody = objectWith<Body>({
  email: optional(IsText),
  metadata: optional(recordOf(IsText)),
  customer: optional(objectWith<{ id: string }>({ id: IsText })),
  source: optional(
    objectWith<{ type: string; id?: string }>({
      type: IsText,
      id: optional(IsText),
    }),
  ),
  merchant_initiated: optional(isFlag),
  previous_payment_id: optional(IsText),
});

/** Reads the body of a request the module sent; a body the model cannot read is a {@link ModelGap}. */
export function ParseBody(text: string | undefined): Body {
  if (text === undefined) return {};
  const parsed: unknown = JSON.parse(text);
  if (!isBody(parsed))
    throw new ModelGap(`the model cannot read the body ${text}`);
  return parsed;
}
