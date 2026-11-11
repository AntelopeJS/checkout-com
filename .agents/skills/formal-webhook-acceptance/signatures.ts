import fc from "fast-check";

import { hmacSha256Hex } from "./oracle.ts";

const HEX_DIGITS = "0123456789abcdef";
const NON_HEX = ["g", "G", "z", " ", "-", "=", "/", "+", ".", ":", "\u0000", "é", " ", "x"];
const PREFIXES = ["sha256=", "0x", "v1=", "hmac "];
const KINDS = [
  "lower",
  "lower",
  "lower",
  "lower",
  "upper",
  "mixed",
  "padded",
  "padded",
  "otherKey",
  "mutatedBody",
  "reencodedBody",
  "truncated",
  "extended",
  "oddLength",
  "nonHex",
  "nearMiss",
  "prefixed",
  "base64",
  "innerSpace",
  "empty",
  "blank",
  "arbitrary",
  "doubled",
] as const;

type Kind = (typeof KINDS)[number];

const spaces = fc.string({
  unit: fc.constantFrom(" ", "\t", "\r", "\n"),
  maxLength: 3,
});

/**
 * One generated signature header value, as data: `kind` picks how it is made
 * from the body and the key, the other fields feed the kinds that need them.
 */
export interface SignatureSpec {
  kind: Kind;
  flags: boolean[];
  left: string;
  right: string;
  text: string;
  index: number;
  bit: number;
  tail: string;
  char: string;
  prefix: string;
}

export const signatureSpec: fc.Arbitrary<SignatureSpec> = fc.record({
  kind: fc.constantFrom(...KINDS),
  flags: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
  left: spaces,
  right: spaces,
  text: fc.string({ maxLength: 40 }),
  index: fc.nat(255),
  bit: fc.nat(14),
  tail: fc.stringMatching(/^[0-9a-f]{1,8}$/),
  char: fc.constantFrom(...NON_HEX),
  prefix: fc.constantFrom(...PREFIXES),
});

interface Inputs {
  hex: string;
  spec: SignatureSpec;
  body: Uint8Array;
  key: string;
}

function mutated(body: Uint8Array, index: number): Uint8Array {
  const bytes = Uint8Array.from(body);
  const operation = bytes.length === 0 ? 1 : index % 4;
  if (operation === 0) {
    bytes[index % bytes.length] ^= 1 << (index % 8);
    return bytes;
  }
  if (operation === 1) {
    return Uint8Array.of(...bytes, index % 256);
  }
  return operation === 2 ? bytes.slice(0, -1) : Uint8Array.of(0x20, ...bytes);
}

function reencoded(body: Uint8Array): Uint8Array {
  const text = Buffer.from(body).toString("utf8");
  return Buffer.from(text.length === 0 ? "\u0000" : text, "utf8");
}

function replaceAt(text: string, index: number, char: string): string {
  return text.slice(0, index) + char + text.slice(index + 1);
}

function nearMiss({ hex, spec }: Inputs): string {
  const at = spec.index % hex.length;
  const digit = (HEX_DIGITS.indexOf(hex.charAt(at)) + 1 + spec.bit) % HEX_DIGITS.length;
  return replaceAt(hex, at, HEX_DIGITS.charAt(digit));
}

function innerSpace({ hex, spec }: Inputs): string {
  const at = 1 + (spec.index % (hex.length - 1));
  return `${hex.slice(0, at)} ${hex.slice(at)}`;
}

function mixedCase({ hex, spec }: Inputs): string {
  return Array.from(hex).map((char, at) => (spec.flags[at] ? char.toUpperCase() : char)).join("");
}

function otherKey({ body, key, spec }: Inputs): string {
  return hmacSha256Hex(spec.text === key ? `${key}!` : spec.text, body);
}

type Derived = "otherKey" | "mutatedBody" | "reencodedBody" | "oddLength" | "nonHex" | "nearMiss" | "innerSpace";

function derived(kind: Derived, inputs: Inputs): string {
  const { hex, spec, body, key } = inputs;
  switch (kind) {
    case "otherKey":
      return otherKey(inputs);
    case "mutatedBody":
      return hmacSha256Hex(key, mutated(body, spec.index));
    case "reencodedBody":
      return hmacSha256Hex(key, reencoded(body));
    case "oddLength":
      return spec.flags[0] ? hex.slice(0, -1) : `${hex}0`;
    case "nonHex":
      return replaceAt(hex, spec.index % hex.length, spec.char);
    case "nearMiss":
      return nearMiss(inputs);
    case "innerSpace":
      return innerSpace(inputs);
  }
}

function makeSignature(kind: Kind, inputs: Inputs): string {
  const { hex, spec } = inputs;
  switch (kind) {
    case "lower":
      return hex;
    case "upper":
      return hex.toUpperCase();
    case "mixed":
      return mixedCase(inputs);
    case "padded":
      return spec.left + (spec.flags[0] ? hex.toUpperCase() : hex) + spec.right;
    case "truncated":
      return hex.slice(0, spec.index % hex.length);
    case "extended":
      return hex + spec.tail;
    case "prefixed":
      return spec.prefix + hex;
    case "base64":
      return Buffer.from(hex, "hex").toString("base64");
    case "empty":
      return "";
    case "blank":
      return `${spec.left} ${spec.right}`;
    case "arbitrary":
      return spec.text;
    case "doubled":
      return hex + hex;
    default:
      return derived(kind, inputs);
  }
}

/** The header value a signature spec stands for, over this body and key. */
export function signatureValue(spec: SignatureSpec, body: Uint8Array, key: string): string {
  return makeSignature(spec.kind, { hex: hmacSha256Hex(key, body), spec, body, key });
}
