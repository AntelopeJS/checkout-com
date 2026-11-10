import {
  type Guard,
  IsCount,
  IsFlag,
  IsObject,
  IsText,
  ListOf,
  ObjectWith,
  Optional,
  RecordOf,
} from "./guards";
import type {
  CkoAction,
  CkoActionAccepted,
  CkoCreated,
  CkoCustomer,
  CkoDelivery,
  CkoEventEnvelope,
  CkoHostedPayment,
  CkoHostedPaymentCreated,
  CkoInstrument,
  CkoMetadata,
  CkoPayment,
} from "./cko-types";

type CkoLinks = CkoPayment["_links"];
type CkoLink = NonNullable<NonNullable<CkoLinks>["self"]>;
type CkoSource = NonNullable<CkoPayment["source"]>;
type CkoCustomerRef = NonNullable<CkoPayment["customer"]>;
type CkoBalances = NonNullable<CkoPayment["balances"]>;
type CkoEventData = CkoEventEnvelope["data"];

function isTextOrCount(value: unknown): value is string | number {
  return IsText(value) || IsCount(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return IsText(value) || IsCount(value) || IsFlag(value);
}

const IsLink = ObjectWith<CkoLink>({ href: IsText });
const IsLinks: Guard<NonNullable<CkoLinks>> = RecordOf(IsLink);
const IsMetadata: Guard<CkoMetadata> = RecordOf(isScalar);

const IsCustomerRef = ObjectWith<CkoCustomerRef>({
  id: Optional(IsText),
  email: Optional(IsText),
  name: Optional(IsText),
});

const IsSource = ObjectWith<CkoSource>({
  id: Optional(IsText),
  type: Optional(IsText),
  scheme: Optional(IsText),
  last4: Optional(isTextOrCount),
  expiry_month: Optional(IsCount),
  expiry_year: Optional(IsCount),
});

const IsBalances = ObjectWith<CkoBalances>({
  total_authorized: Optional(IsCount),
  total_voided: Optional(IsCount),
  available_to_void: Optional(IsCount),
  total_captured: Optional(IsCount),
  available_to_capture: Optional(IsCount),
  total_refunded: Optional(IsCount),
  available_to_refund: Optional(IsCount),
});

export const IsCkoPayment = ObjectWith<CkoPayment>({
  id: IsText,
  status: IsText,
  action_id: Optional(IsText),
  amount: Optional(IsCount),
  currency: Optional(IsText),
  approved: Optional(IsFlag),
  response_code: Optional(isTextOrCount),
  response_summary: Optional(IsText),
  reference: Optional(IsText),
  requested_on: Optional(IsText),
  processed_on: Optional(IsText),
  payment_type: Optional(IsText),
  source: Optional(IsSource),
  customer: Optional(IsCustomerRef),
  balances: Optional(IsBalances),
  metadata: Optional(IsMetadata),
  scheme_id: Optional(isTextOrCount),
  _links: Optional(IsLinks),
});

const IsCkoAction = ObjectWith<CkoAction>({
  id: IsText,
  type: IsText,
  amount: IsCount,
  approved: Optional(IsFlag),
  response_code: isTextOrCount,
  response_summary: Optional(IsText),
  processed_on: IsText,
  reference: Optional(IsText),
  metadata: Optional(IsMetadata),
});

export const IsCkoActions = ListOf(IsCkoAction);

export const IsCkoActionAccepted = ObjectWith<CkoActionAccepted>({
  action_id: IsText,
  reference: Optional(IsText),
});

export const IsCkoInstrument = ObjectWith<CkoInstrument>({
  id: IsText,
  type: IsText,
  scheme: Optional(IsText),
  last4: Optional(isTextOrCount),
  expiry_month: Optional(IsCount),
  expiry_year: Optional(IsCount),
  customer: Optional(IsCustomerRef),
});

export const IsCkoCustomer = ObjectWith<CkoCustomer>({
  id: IsText,
  email: Optional(IsText),
  name: Optional(IsText),
  default: Optional(IsText),
  metadata: Optional(IsMetadata),
  instruments: Optional(ListOf(IsCkoInstrument)),
});

export const IsCkoCreated = ObjectWith<CkoCreated>({ id: IsText });

export const IsCkoHostedPaymentCreated = ObjectWith<CkoHostedPaymentCreated>({
  id: IsText,
  reference: Optional(IsText),
  _links: IsLinks,
});

export const IsCkoHostedPayment = ObjectWith<CkoHostedPayment>({
  id: IsText,
  status: IsText,
  payment_id: Optional(IsText),
  amount: Optional(IsCount),
  currency: Optional(IsText),
  reference: Optional(IsText),
  expires_on: Optional(IsText),
  metadata: Optional(IsMetadata),
  _links: IsLinks,
});

const IsEventData = ObjectWith<CkoEventData>({
  id: IsText,
  action_id: Optional(IsText),
  amount: Optional(IsCount),
  currency: Optional(IsText),
  processed_on: Optional(IsText),
  response_code: Optional(isTextOrCount),
  response_summary: Optional(IsText),
  metadata: Optional(IsMetadata),
  payment_id: Optional(IsText),
  category: Optional(IsText),
  reason_code: Optional(IsText),
  date: Optional(IsText),
});

export const IsCkoDelivery = ObjectWith<CkoDelivery>({
  id: IsText,
  type: IsText,
  data: IsObject,
});

export const IsCkoEventEnvelope = ObjectWith<CkoEventEnvelope>({
  id: IsText,
  type: IsText,
  created_on: Optional(IsText),
  timestamp: Optional(IsText),
  data: IsEventData,
});
