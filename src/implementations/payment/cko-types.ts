type CkoScalar = string | number | boolean;

export type CkoMetadata = Record<string, CkoScalar>;

interface CkoLink {
  href: string;
}

interface CkoLinks {
  self?: CkoLink;
  redirect?: CkoLink;
  [name: string]: CkoLink | undefined;
}

interface CkoBalances {
  total_authorized?: number;
  total_voided?: number;
  available_to_void?: number;
  total_captured?: number;
  available_to_capture?: number;
  total_refunded?: number;
  available_to_refund?: number;
}

interface CkoSource {
  id?: string;
  type?: string;
  scheme?: string;
  last4?: string | number;
  expiry_month?: number;
  expiry_year?: number;
}

interface CkoCustomerRef {
  id?: string;
  email?: string;
  name?: string;
}

/**
 * The union of what `POST /payments` (201 and 202) and `GET /payments/{id}`
 * answer. Every field is optional because the three shapes overlap only on `id`
 * and `status`.
 */
export interface CkoPayment {
  id: string;
  status: string;
  action_id?: string;
  amount?: number;
  currency?: string;
  approved?: boolean;
  response_code?: string | number;
  response_summary?: string;
  reference?: string;
  requested_on?: string;
  processed_on?: string;
  payment_type?: string;
  source?: CkoSource;
  customer?: CkoCustomerRef;
  balances?: CkoBalances;
  metadata?: CkoMetadata;
  scheme_id?: string | number;
  _links?: CkoLinks;
}

export interface CkoAction {
  id: string;
  type: string;
  amount: number;
  approved?: boolean;
  response_code: string | number;
  response_summary?: string;
  processed_on: string;
  reference?: string;
  metadata?: CkoMetadata;
}

export interface CkoActionAccepted {
  action_id: string;
  reference?: string;
}

export interface CkoInstrument {
  id: string;
  type: string;
  scheme?: string;
  last4?: string | number;
  expiry_month?: number;
  expiry_year?: number;
  customer?: CkoCustomerRef;
}

export interface CkoCustomer {
  id: string;
  email?: string;
  name?: string;
  default?: string;
  metadata?: CkoMetadata;
  instruments?: CkoInstrument[];
}

export interface CkoCreated {
  id: string;
}

export interface CkoHostedPaymentCreated {
  id: string;
  reference?: string;
  _links: CkoLinks;
}

export interface CkoHostedPayment {
  id: string;
  status: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  expires_on?: string;
  metadata?: CkoMetadata;
  _links: CkoLinks;
}

export interface CkoEventEnvelope {
  id: string;
  type: string;
  created_on?: string;
  timestamp?: string;
  data: CkoEventData;
}

interface CkoPaymentEventData {
  id: string;
  action_id?: string;
  amount?: number;
  currency?: string;
  processed_on?: string;
  response_code?: string | number;
  response_summary?: string;
  metadata?: CkoMetadata;
}

export interface CkoDisputeEventData {
  id: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  category?: string;
  reason_code?: string;
  date?: string;
}

/** The `data` of a delivery: a payment action's, or a dispute's. */
interface CkoEventData
  extends
    CkoPaymentEventData,
    Omit<CkoDisputeEventData, "amount" | "currency"> {}
