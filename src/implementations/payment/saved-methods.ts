import { IsCkoCustomer } from "./resources";
import type { Payment } from "@antelopejs/interface-payment";

import type { CkoClient } from "./http";
import type { CkoCustomer, CkoMetadata } from "./cko-types";

/**
 * Checkout.com stores an instrument with no creation time and no link to the
 * payment that stored it, yet a merchant-initiated charge should name that
 * payment as `previous_payment_id`. The customer's metadata is the one durable
 * place at the provider to keep both, one entry per instrument:
 * `antelope_method_<src_…>` → `<pay_…> <saved at, epoch ms>`.
 */
const METHOD_KEY_PREFIX = "antelope_method_";
const IDEMPOTENCY_KEY = "antelope_idempotency";
const METADATA_LIMIT = 20;
const RECORD_SEPARATOR = " ";

export interface SavedMethod {
  initialPayment: string;
  savedAt: number;
}

export function IdempotencyMetadataKey(): string {
  return IDEMPOTENCY_KEY;
}

function methodKey(instrument: string): string {
  return `${METHOD_KEY_PREFIX}${instrument}`;
}

export function IsInternalCustomerKey(key: string): boolean {
  return key === IDEMPOTENCY_KEY || key.startsWith(METHOD_KEY_PREFIX);
}

type MetadataValue = CkoMetadata[string] | undefined;

function isString(value: MetadataValue): value is string {
  return typeof value === "string";
}

export function ReadSavedMethod(
  metadata: CkoMetadata | undefined,
  instrument: string,
): SavedMethod | undefined {
  const raw = metadata?.[methodKey(instrument)];
  if (!isString(raw)) return undefined;
  const [initialPayment = "", savedAt = ""] = raw.split(RECORD_SEPARATOR);
  const time = Number(savedAt);
  return initialPayment && Number.isFinite(time)
    ? { initialPayment, savedAt: time }
    : undefined;
}

function prunedMetadata(customer: CkoCustomer): CkoMetadata {
  const listed = new Set((customer.instruments ?? []).map(({ id }) => id));
  const kept = Object.entries(customer.metadata ?? {}).filter(
    ([key]) =>
      !key.startsWith(METHOD_KEY_PREFIX) ||
      listed.has(key.slice(METHOD_KEY_PREFIX.length)),
  );
  return Object.fromEntries(kept);
}

/**
 * Records the payment that stored an instrument, the first time it is seen,
 * and links the instrument to the customer when the customer does not list it
 * yet, as for an instrument saved from an earlier payment. Returns whether the
 * record is in place afterwards: Checkout.com allows 20 metadata entries per
 * customer, and a customer already at the limit gets no record, which leaves
 * later charges to Checkout.com's own lookup of the initial payment.
 */
async function RecordSavedMethod(
  client: CkoClient,
  customerId: string,
  instrument: string,
  initialPayment: string,
): Promise<boolean> {
  const { body: customer } = await client.send(
    {
      method: "GET",
      path: `/customers/${customerId}`,
    },
    IsCkoCustomer,
  );
  if (ReadSavedMethod(customer.metadata, instrument)) return true;
  if (!(customer.instruments ?? []).some(({ id }) => id === instrument)) {
    await client.execute({
      method: "PATCH",
      path: `/instruments/${instrument}`,
      body: { customer: { id: customerId } },
    });
  }
  const metadata = {
    ...prunedMetadata(customer),
    [methodKey(instrument)]:
      `${initialPayment}${RECORD_SEPARATOR}${Date.now()}`,
  };
  if (Object.keys(metadata).length > METADATA_LIMIT) return false;
  await client.execute({
    method: "PATCH",
    path: `/customers/${customerId}`,
    body: { metadata },
  });
  return true;
}

export async function FindSavedMethod(
  client: CkoClient,
  customerId: string,
  instrument: string,
): Promise<SavedMethod | undefined> {
  const { body: customer } = await client.send(
    {
      method: "GET",
      path: `/customers/${customerId}`,
    },
    IsCkoCustomer,
  );
  return ReadSavedMethod(customer.metadata, instrument);
}

/**
 * Records the card a payment saved for `customer` once the payment carries
 * it: on the answer to `CreatePayment`, or, for a payment that sent the payer
 * through 3DS or a hosted page first, on the first read or webhook that sees
 * it authorized. The payment has already happened, so a failure is reported
 * rather than thrown, and the next read or delivery tries again.
 */
export async function RememberSave(
  client: CkoClient,
  customer: MetadataValue,
  payment: Payment,
): Promise<void> {
  if (!isString(customer) || !payment.paymentMethod) return;
  if (payment.status === "failed" || payment.status === "canceled") return;
  await RecordSavedMethod(
    client,
    customer,
    payment.paymentMethod,
    payment.id,
  ).catch((cause: unknown) => {
    process.stderr.write(
      `Checkout.com: payment ${payment.id} saved ${payment.paymentMethod} but recording it against ${customer} failed (${cause instanceof Error ? cause.message : String(cause)}); the next read of the payment retries\n`,
    );
  });
}
