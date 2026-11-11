import { createHash } from "node:crypto";

import type { WebhookRequest } from "@antelopejs/interface-payment";

/** A delivery as `VerifyWebhook` hands it to `AssertGenuine`: the request, the account's signature key and its `Authorization` value. */
export interface Delivery {
  body: Uint8Array;
  headers: WebhookRequest["headers"];
  key: string;
  authorization: string | undefined;
}

/** What the oracle reads off a delivery. `valid` and `matching` mean every value agrees; `mixed` means some do and some do not. */
export interface Facts {
  key: "set" | "unset";
  signature: "valid" | "invalid" | "mixed";
  authorization: "unset" | "matching" | "mismatching" | "mixed";
  verdict: "genuine" | "refused" | "ambiguous";
}

const BLOCK_BYTES = 64;
const SIGNATURE_NAME = "cko-signature";
const AUTHORIZATION_NAME = "authorization";
const SIGNATURE_DIGEST = /^[0-9a-fA-F]{64}$/;
const SURROUNDING_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function xorPad(key: Uint8Array, pad: number): Uint8Array {
  return Uint8Array.from(key, (byte) => byte ^ pad);
}

/**
 * HMAC-SHA256 of RFC 2104, built from the SHA-256 primitive alone, so the
 * oracle shares no keyed-hash call with the module under check.
 */
export function hmacSha256Hex(key: string, body: Uint8Array): string {
  const keyBytes = Buffer.from(key, "utf8");
  const block = Buffer.alloc(BLOCK_BYTES);
  (keyBytes.length > BLOCK_BYTES ? sha256(keyBytes) : keyBytes).copy(block);
  const inner = sha256(xorPad(block, 0x36), Uint8Array.from(body));
  return sha256(xorPad(block, 0x5c), inner).toString("hex");
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function valuesOf(headers: Delivery["headers"], name: string): string[] {
  return Object.entries(headers)
    .filter(([header]) => asciiLower(header) === name)
    .flatMap(([, value]) => (value === undefined ? [] : [value].flat()));
}

type Tally = "none" | "all" | "some";

function tally(flags: boolean[]): Tally {
  if (flags.every((flag) => !flag)) {
    return "none";
  }
  return flags.every(Boolean) ? "all" : "some";
}

function signatureFacet(delivery: Delivery): Facts["signature"] {
  const expected = hmacSha256Hex(delivery.key, delivery.body);
  const matches = valuesOf(delivery.headers, SIGNATURE_NAME).map((value) => {
    const trimmed = value.replace(SURROUNDING_SPACE, "");
    return SIGNATURE_DIGEST.test(trimmed) && trimmed.toLowerCase() === expected;
  });
  const result = tally(matches);
  if (result === "all") {
    return "valid";
  }
  return result === "some" ? "mixed" : "invalid";
}

function authorizationFacet(delivery: Delivery): Facts["authorization"] {
  if (delivery.authorization === undefined) {
    return "unset";
  }
  const matches = valuesOf(delivery.headers, AUTHORIZATION_NAME).map(
    (value) => value === delivery.authorization,
  );
  const result = tally(matches);
  if (result === "all") {
    return "matching";
  }
  return result === "some" ? "mixed" : "mismatching";
}

function verdictOf(facts: Omit<Facts, "verdict">): Facts["verdict"] {
  if (
    facts.key === "unset" ||
    facts.signature === "invalid" ||
    facts.authorization === "mismatching"
  ) {
    return "refused";
  }
  return facts.signature === "mixed" || facts.authorization === "mixed" ? "ambiguous" : "genuine";
}

/**
 * What the contract of `VerifyWebhook` says about a delivery, read apart from
 * the module. `refused` and `genuine` hold under every reading of the
 * contract. `ambiguous` marks a delivery whose repeated header values disagree,
 * where the contract names no winner: at least one value is a valid signature
 * (or the configured authorization), so accepting it lets nothing forged in.
 */
export function expectation(delivery: Delivery): Facts {
  const facts: Omit<Facts, "verdict"> = {
    key: delivery.key === "" ? "unset" : "set",
    signature: signatureFacet(delivery),
    authorization: authorizationFacet(delivery),
  };
  return { ...facts, verdict: verdictOf(facts) };
}
