import { IsCkoCustomer, IsCkoInstrument } from "./resources";
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

/** Whether the customer has the card, and the record of the payment that saved it. */
export async function FindSavedMethod(
  client: CkoClient,
  customerId: string,
  instrument: string,
): Promise<{ isListed: boolean; saved: SavedMethod | undefined }> {
  const { body: customer } = await client.send(
    {
      method: "GET",
      path: `/customers/${customerId}`,
    },
    IsCkoCustomer,
  );
  return {
    isListed: (customer.instruments ?? []).some(({ id }) => id === instrument),
    saved: ReadSavedMethod(customer.metadata, instrument),
  };
}

const recordsInFlight = new Map<string, Promise<unknown>>();

/**
 * Checkout.com replaces a customer's whole metadata on every PATCH and offers
 * no conditional write, so two records built from the same read keep only the
 * last. Writes for one customer therefore wait for each other in this process,
 * keyed by its `cus_` id; a card's save and detach also wait for each other,
 * keyed by its `src_` id, always taken before the customer's.
 * Two processes saving cards for one customer at the same moment can still
 * lose one card's record, which leaves that card's charges to Checkout.com's
 * own lookup of the initial payment.
 */
function oneAtATime<T>(customer: string, write: () => Promise<T>): Promise<T> {
  const previous = recordsInFlight.get(customer) ?? Promise.resolve();
  const current = previous.then(write, write);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  recordsInFlight.set(customer, settled);
  void settled.then(() => {
    if (recordsInFlight.get(customer) === settled) {
      recordsInFlight.delete(customer);
    }
  });
  return current;
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
  const instrument = payment.paymentMethod;
  await oneAtATime(instrument, () =>
    oneAtATime(customer, () =>
      RecordSavedMethod(client, customer, instrument, payment.id),
    ),
  ).catch((cause: unknown) => {
    process.stderr.write(
      `Checkout.com: payment ${payment.id} saved ${payment.paymentMethod} but recording it against ${customer} failed (${cause instanceof Error ? cause.message : String(cause)}); the next read of the payment retries\n`,
    );
  });
}

async function pruneRecords(client: CkoClient, customerId: string) {
  const { body: customer } = await client.send(
    { method: "GET", path: `/customers/${customerId}` },
    IsCkoCustomer,
  );
  const kept = prunedMetadata(customer);
  const held = Object.keys(customer.metadata ?? {}).length;
  if (Object.keys(kept).length === held) return;
  await client.execute({
    method: "PATCH",
    path: `/customers/${customerId}`,
    body: { metadata: kept },
  });
}

async function deleteAndPrune(
  client: CkoClient,
  instrument: string,
): Promise<void> {
  const { body } = await client.send(
    { method: "GET", path: `/instruments/${instrument}` },
    IsCkoInstrument,
  );
  const remove = () =>
    client.execute({ method: "DELETE", path: `/instruments/${instrument}` });
  const customer = body.customer?.id;
  if (!customer) {
    await remove();
    return;
  }
  await oneAtATime(customer, async () => {
    await remove();
    await pruneRecords(client, customer).catch((cause: unknown) => {
      process.stderr.write(
        `Checkout.com: ${instrument} was deleted but pruning its record from ${customer} failed (${cause instanceof Error ? cause.message : String(cause)}); the customer's next save prunes it\n`,
      );
    });
  });
}

/**
 * Deletes a saved instrument and, when it belongs to a customer, the record of
 * the payment that saved it. A save and a detach of one card wait for each
 * other, each taking the card's chain before the customer's: a save that ran
 * first has linked the card, so the detach finds its customer and prunes the
 * record, and a save that runs after finds the card gone and records nothing.
 * The instrument is gone once this resolves; a failed prune is reported, and
 * the customer's next save prunes it.
 */
export function DeleteSavedMethod(
  client: CkoClient,
  instrument: string,
): Promise<void> {
  return oneAtATime(instrument, () => deleteAndPrune(client, instrument));
}
