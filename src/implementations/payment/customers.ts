import { IsCkoCreated, IsCkoCustomer } from "./resources";
import { createHash } from "node:crypto";
import { PaymentError } from "@antelopejs/interface-payment";
import type {
  Customer,
  CustomerRequest,
  PaymentMethod,
} from "@antelopejs/interface-payment";

import { CkoApiError } from "./http";
import { Translating } from "./errors";
import { GetAccount } from "./accounts";
import type { CkoClient } from "./http";
import { ToPaymentMethod } from "./mapping";
import { AssertCustomerId, AssertInstrumentId } from "./ids";
import type { CkoCustomer, CkoCustomerRequest, CkoMetadata } from "./cko-types";
import {
  IdempotencyMetadataKey,
  IsInternalCustomerKey,
  ReadSavedMethod,
} from "./saved-methods";

const CUSTOMER_ENTITY = { entity: "customer" as const };
const METHOD_ENTITY = { entity: "payment method" as const };
const EMAIL_TAKEN = "customer_email_already_exists";
const UNKNOWN_SAVE_TIME = 0;

function callerMetadata(
  metadata: CkoMetadata | undefined,
): Record<string, string> {
  const own = Object.entries(metadata ?? {}).filter(
    ([key]) => !IsInternalCustomerKey(key),
  );
  return Object.fromEntries(own.map(([key, value]) => [key, String(value)]));
}

function toCustomer(customer: CkoCustomer): Customer {
  const metadata = callerMetadata(customer.metadata);
  const read: Customer = { id: customer.id };
  if (customer.email) {
    read.email = customer.email;
  }
  if (customer.name) {
    read.name = customer.name;
  }
  if (Object.keys(metadata).length > 0) {
    read.metadata = metadata;
  }
  return read;
}

function keyFingerprint(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

function isEmailTaken(cause: unknown): boolean {
  return cause instanceof CkoApiError && cause.errorCodes.includes(EMAIL_TAKEN);
}

/**
 * `/customers` takes no idempotency key, but Checkout.com keeps emails unique
 * and reads a customer back by email. The key's fingerprint is stored on the
 * customer, so a replay that collides with its own first attempt is recognised
 * and answered with that customer; a collision with anyone else's is refused.
 */
async function replayed(
  client: CkoClient,
  email: string,
  fingerprint: string,
): Promise<Customer> {
  const { body: existing } = await client.send(
    {
      method: "GET",
      path: `/customers/${encodeURIComponent(email)}`,
    },
    IsCkoCustomer,
  );
  if (existing.metadata?.[IdempotencyMetadataKey()] !== fingerprint) {
    throw new PaymentError(
      `A Checkout.com customer with the email ${email} already exists`,
      EMAIL_TAKEN,
    );
  }
  return toCustomer(existing);
}

export async function CreateCustomer(
  request: CustomerRequest,
  idempotencyKey: string,
  provider?: string,
): Promise<Customer> {
  const email = request.email;
  if (!email) {
    throw new PaymentError(
      "Checkout.com requires an email address for every customer",
      "email_required",
    );
  }
  const { client } = GetAccount(provider);
  const fingerprint = keyFingerprint(idempotencyKey);
  const metadata = {
    ...request.metadata,
    [IdempotencyMetadataKey()]: fingerprint,
  };
  const sent: CkoCustomerRequest = { email, metadata };
  if (request.name) {
    sent.name = request.name;
  }
  return Translating("", CUSTOMER_ENTITY, async () => {
    try {
      const { body } = await client.send(
        {
          method: "POST",
          path: "/customers",
          body: sent,
        },
        IsCkoCreated,
      );
      return toCustomer({ id: body.id, email, name: request.name, metadata });
    } catch (error) {
      if (!isEmailTaken(error)) throw error;
      return replayed(client, email, fingerprint);
    }
  });
}

export async function GetCustomer(
  id: string,
  provider?: string,
): Promise<Customer> {
  AssertCustomerId(id);
  const { client } = GetAccount(provider);
  return Translating(id, CUSTOMER_ENTITY, async () => {
    const { body } = await client.send(
      {
        method: "GET",
        path: `/customers/${id}`,
      },
      IsCkoCustomer,
    );
    return toCustomer(body);
  });
}

export async function DeleteCustomer(
  id: string,
  _idempotencyKey: string,
  provider?: string,
): Promise<void> {
  AssertCustomerId(id);
  const { client } = GetAccount(provider);
  await Translating(id, CUSTOMER_ENTITY, () =>
    client.execute({ method: "DELETE", path: `/customers/${id}` }),
  );
}

/**
 * A customer's instruments are listed only inside the customer. Checkout.com
 * records no creation time for an instrument, so `createdAt` is when this
 * module saved it, and 0 for an instrument saved some other way.
 */
export async function ListPaymentMethods(
  customer: string,
  provider?: string,
): Promise<PaymentMethod[]> {
  AssertCustomerId(customer);
  const { client } = GetAccount(provider);
  return Translating(customer, CUSTOMER_ENTITY, async () => {
    const { body } = await client.send(
      {
        method: "GET",
        path: `/customers/${customer}`,
      },
      IsCkoCustomer,
    );
    const methods = (body.instruments ?? []).map((instrument) =>
      ToPaymentMethod(
        instrument,
        customer,
        ReadSavedMethod(body.metadata, instrument.id)?.savedAt ??
          UNKNOWN_SAVE_TIME,
      ),
    );
    return methods.sort((first, second) => second.createdAt - first.createdAt);
  });
}

export async function DetachPaymentMethod(
  id: string,
  _idempotencyKey: string,
  provider?: string,
): Promise<void> {
  AssertInstrumentId(id);
  const { client } = GetAccount(provider);
  await Translating(id, METHOD_ENTITY, () =>
    client.execute({ method: "DELETE", path: `/instruments/${id}` }),
  );
}
