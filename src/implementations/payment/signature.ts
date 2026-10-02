import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WebhookVerificationError,
  type WebhookRequest,
} from "@antelopejs/interface-payment";

const SIGNATURE_HEADER = "cko-signature";
const AUTHORIZATION_HEADER = "authorization";
const HEX_DIGEST = /^[0-9a-f]{64}$/i;

function readHeader(
  headers: WebhookRequest["headers"],
  name: string,
): string | undefined {
  const raw = Object.entries(headers).find(
    ([header]) => header.toLowerCase() === name,
  )?.[1];
  return Array.isArray(raw) ? raw[0] : raw;
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertSigned(request: WebhookRequest, signatureKey: string): void {
  const signature = readHeader(request.headers, SIGNATURE_HEADER)?.trim();
  if (!signature) {
    throw new WebhookVerificationError(
      "The delivery carried no Cko-Signature header",
    );
  }
  if (!HEX_DIGEST.test(signature)) {
    throw new WebhookVerificationError(
      "The Cko-Signature header is not a hex HMAC-SHA256 digest",
    );
  }
  const expected = createHmac("sha256", signatureKey)
    .update(request.body)
    .digest();
  if (!sameBytes(expected, Buffer.from(signature, "hex"))) {
    throw new WebhookVerificationError(
      "The Cko-Signature header does not match the body",
    );
  }
}

function assertAuthorized(
  request: WebhookRequest,
  authorization: string | undefined,
): void {
  if (!authorization) {
    return;
  }
  const received = readHeader(request.headers, AUTHORIZATION_HEADER) ?? "";
  if (!sameBytes(Buffer.from(received), Buffer.from(authorization))) {
    throw new WebhookVerificationError(
      "The delivery's Authorization header does not match the configured value",
    );
  }
}

/**
 * Establishes a delivery as Checkout.com's: the `Cko-Signature` header must be
 * the HMAC-SHA256 of the raw body under the workflow's signature key, and, when
 * the workflow was given an `Authorization` header value, that value must come
 * back too. Checkout.com signs no timestamp, so nothing here limits replay;
 * de-duplicating on the event id is the caller's defence.
 */
export function AssertGenuine(
  request: WebhookRequest,
  signatureKey: string,
  authorization: string | undefined,
): void {
  if (!signatureKey) {
    throw new WebhookVerificationError(
      "No webhook signature key is configured, so no delivery can be verified",
    );
  }
  assertSigned(request, signatureKey);
  assertAuthorized(request, authorization);
}
