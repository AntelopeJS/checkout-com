import { randomBytes } from "node:crypto";

export type Metadata = Record<string, string | number | boolean>;

export interface SimCard {
  number: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface SimToken {
  id: string;
  card: SimCard;
  isUsed: boolean;
  expiresAt: number;
}

export interface SimInstrument {
  id: string;
  card: SimCard;
  customer?: string;
}

export interface SimCustomer {
  id: string;
  email: string;
  name?: string;
  metadata: Metadata;
  defaultInstrument?: string;
}

export interface SimAction {
  id: string;
  type: string;
  amount: number;
  approved?: boolean;
  responseCode: string;
  responseSummary: string;
  processedOn: string;
  metadata?: Metadata;
}

export interface SimBalances {
  total_authorized: number;
  total_voided: number;
  available_to_void: number;
  total_captured: number;
  available_to_capture: number;
  total_refunded: number;
  available_to_refund: number;
}

export interface SimPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  approved: boolean;
  reference?: string;
  description?: string;
  requestedOn: string;
  instrument?: string;
  customer?: string;
  metadata?: Metadata;
  paymentType: string;
  isMerchantInitiated: boolean;
  previousPaymentId?: string;
  isAutoCapture: boolean;
  responseCode: string;
  responseSummary: string;
  balances: SimBalances;
  actions: SimAction[];
  redirectUrl?: string;
}

export interface SimHostedPayment {
  id: string;
  status: string;
  request: Record<string, unknown>;
  paymentId?: string;
  createdAt: number;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const STANDARD_ID_LENGTH = 26;
const HOSTED_ID_LENGTH = 12;
const HOSTED_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** An identifier shaped as Checkout.com documents its prefix. */
export function NewId(prefix: string): string {
  return `${prefix}_${randomString(STANDARD_ID_LENGTH, ID_ALPHABET)}`;
}

export function NewHostedId(): string {
  return `hpp_${randomString(HOSTED_ID_LENGTH, HOSTED_ALPHABET)}`;
}

export function EmptyBalances(): SimBalances {
  return {
    total_authorized: 0,
    total_voided: 0,
    available_to_void: 0,
    total_captured: 0,
    available_to_capture: 0,
    total_refunded: 0,
    available_to_refund: 0,
  };
}

export class SimState {
  readonly tokens = new Map<string, SimToken>();
  readonly instruments = new Map<string, SimInstrument>();
  readonly customers = new Map<string, SimCustomer>();
  readonly payments = new Map<string, SimPayment>();
  readonly hosted = new Map<string, SimHostedPayment>();

  customerByEmail(email: string): SimCustomer | undefined {
    return [...this.customers.values()].find(
      (customer) => customer.email.toLowerCase() === email.toLowerCase(),
    );
  }

  instrumentsOf(customer: string): SimInstrument[] {
    return [...this.instruments.values()].filter(
      (instrument) => instrument.customer === customer,
    );
  }
}
