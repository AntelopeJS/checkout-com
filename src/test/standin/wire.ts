import type { Metadata } from "./state";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

/** An object as it travels in JSON; a key holding `undefined` is omitted when serialized. */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** `JSON.parse`, whose result is JSON by construction. */
export function ParseJson(text: string): JsonValue {
  return JSON.parse(text);
}

export function isJsonObject(
  value: JsonValue | undefined,
): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function isScalar(
  value: JsonValue | undefined,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isMetadata(value: JsonObject): value is Metadata {
  return Object.values(value).every(isScalar);
}

export function ObjectOf(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function TextOf(value: JsonValue | undefined): string | undefined {
  return isText(value) ? value : undefined;
}

export function CountOf(value: JsonValue | undefined): number | undefined {
  return isCount(value) ? value : undefined;
}

export function MetadataOf(value: JsonValue | undefined): Metadata | undefined {
  return isJsonObject(value) && isMetadata(value) ? value : undefined;
}
