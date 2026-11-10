/** The domain the model and the scenarios share: rules, operations, requests and the saved-method records. */
import { type Body, type JsonObject, type Metadata, IsText } from "./wire.mts";

export const RULES = [
  "MetadataLimit",
  "CallerKeysKept",
  "ChainMatchesRecord",
  "RecordKept",
  "ListMatchesRecord",
  "NoRecordOutlivesInstrument",
  "Settles",
] as const;

export type Rule = (typeof RULES)[number];
export type Semantics = "replace" | "merge";
export type Flow = "frictionless" | "3ds";

/** What one `GET /customers/{id}` showed the operation that sent it. */
interface Read {
  metadata: Metadata;
  instruments: string[];
}

interface Running {
  label: string;
  reads: Read[];
  settled: boolean;
}

/** One call an app makes on the module, or the payer's 3DS step and return. */
export type Operation = Running &
  (
    | { kind: "create" | "list" }
    | { kind: "save"; card: number; flow: Flow }
    | { kind: "return" | "read" | "charge" | "detach"; card: number }
  );

export interface Request {
  method: string;
  path: string;
  body: Body;
}

export interface Reply {
  status: number;
  body?: JsonObject;
}

/** What one run reached, summed into the coverage line. */
export interface Coverage {
  interleaved: number;
  records: number;
  recordedAfter3ds: number;
  chained: number;
  unchained: number;
  detachedRecorded: number;
  lists: number;
  unrecordedIn3ds: number;
  unrecordedAuthorized: number;
}

interface SavedRecord {
  payment: string;
  savedAt: number;
}

const METHOD_PREFIX = "antelope_method_";
const ID_LENGTH = 26;

/** A Checkout.com identifier: the prefix, then `name` padded to 26 word characters. */
export function PaddedId(prefix: string, name: string): string {
  return `${prefix}_${name.padEnd(ID_LENGTH, "0")}`;
}

/** The record the metadata holds for `instrument`: the saving payment and the save time. */
export function RecordOf(
  metadata: Metadata,
  instrument: string,
): SavedRecord | undefined {
  const key = `${METHOD_PREFIX}${instrument}`;
  const raw = Object.hasOwn(metadata, key) ? metadata[key] : undefined;
  if (!IsText(raw)) return undefined;
  const [payment = "", savedAt = ""] = raw.split(" ");
  return { payment, savedAt: Number(savedAt) };
}

export function RecordedInstruments(metadata: Metadata): string[] {
  return Object.keys(metadata)
    .filter((key) => key.startsWith(METHOD_PREFIX))
    .map((key) => key.slice(METHOD_PREFIX.length));
}
