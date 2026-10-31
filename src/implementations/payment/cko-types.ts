/** A value as JSON carries it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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

/** What every delivery carries, whatever its type. Only a type this module maps has its `data` read, as a {@link CkoEventEnvelope}. */
export interface CkoDelivery {
  id: string;
  type: string;
  data: object;
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

/** How a `POST /payments` request names the method to charge. */
export type CkoPaymentSource =
  | { type: "id"; id: string }
  | { type: "token"; token: string; store_for_future_use: boolean };

/** The 3DS settings of a request that takes a mandate from the payer. */
interface CkoThreeDs {
  enabled: boolean;
  challenge_indicator: string;
}

/** How a `POST /payments` request declares the payer's presence. */
export interface CkoInitiation {
  merchant_initiated?: boolean;
  payment_type?: string;
  previous_payment_id?: string;
  "3ds"?: CkoThreeDs;
}

/** The body of `POST /payments`. */
export interface CkoPaymentRequest extends CkoInitiation {
  source: CkoPaymentSource;
  amount: number;
  currency: string;
  reference: string;
  capture: boolean;
  processing_channel_id: string;
  metadata: CkoMetadata;
  description?: string;
  customer?: { id: string };
  success_url?: string;
  failure_url?: string;
}

/** The payer a hosted payment page is opened for. */
export interface CkoHostedCustomer {
  email?: string;
  name?: string;
}

/** The body of `POST /hosted-payments`. */
export interface CkoHostedPaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  billing: { address: { country: string } };
  success_url: string;
  cancel_url: string;
  failure_url: string;
  capture: boolean;
  processing_channel_id: string;
  metadata: CkoMetadata;
  description?: string;
  locale?: string;
  customer?: CkoHostedCustomer;
  payment_type?: string;
  payment_method_configuration?: {
    card: { store_payment_details: string };
  };
  "3ds"?: CkoThreeDs;
}

/** The body of `POST /customers`. */
export interface CkoCustomerRequest {
  email: string;
  metadata: CkoMetadata;
  name?: string;
}

/** The body of `POST /payments/{id}/refunds`. */
export interface CkoRefundRequest {
  metadata: CkoMetadata;
  amount?: number;
}
