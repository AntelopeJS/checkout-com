import type { CkoMetadata } from "../implementations/payment/cko-types";

export interface PaymentDetailsView {
  payment_type?: string;
}

export interface CustomerView {
  metadata?: CkoMetadata;
}

export interface ActionView {
  id: string;
  type: string;
}

export function isObject(body: unknown): body is object {
  return typeof body === "object" && body !== null;
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isMetadata(value: unknown): value is CkoMetadata {
  return isObject(value) && Object.values(value).every(isScalar);
}

export function isPaymentDetails(body: unknown): body is PaymentDetailsView {
  return (
    isObject(body) &&
    (!("payment_type" in body) || typeof body.payment_type === "string")
  );
}

export function isCustomer(body: unknown): body is CustomerView {
  return isObject(body) && (!("metadata" in body) || isMetadata(body.metadata));
}

function isAction(body: unknown): body is ActionView {
  return (
    isObject(body) &&
    "id" in body &&
    typeof body.id === "string" &&
    "type" in body &&
    typeof body.type === "string"
  );
}

export function isActions(body: unknown): body is ActionView[] {
  return Array.isArray(body) && body.every(isAction);
}
