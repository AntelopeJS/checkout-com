/**
 * An in-memory Checkout.com holding one customer: the endpoints the
 * saved-method chain calls, answered one request per scheduler step. A PATCH
 * of the customer's metadata either replaces the whole map, as the sandbox
 * does, or merges into it. After every step it checks the rules that must
 * hold at every step. It never refuses a write over the 20-pair limit, so
 * `MetadataLimit` sees what the module would make Checkout.com hold.
 */
import {
  type Coverage,
  type Flow,
  type Operation,
  type Reply,
  type Request,
  type Rule,
  type Semantics,
  PaddedId,
  RecordOf,
  RecordedInstruments,
} from "./domain.mts";
import {
  type Body,
  type JsonObject,
  type Metadata,
  ModelGap,
} from "./wire.mts";

interface Routed extends Request {
  id: string;
  op: Operation;
}
interface Card {
  name: string;
  ready: Promise<void>;
  created: () => void;
  flow?: Flow;
  instrument?: string;
  payment?: string;
}
interface StoredPayment {
  instrument: string;
  metadata: Metadata | undefined;
  inThreeDs: boolean;
}
interface Breakage {
  states: number;
  detail: string;
}
const PAIR_LIMIT = 20;
const BASE_URL = "https://checkout.invalid";

function reply(status: number, body?: JsonObject): Reply {
  return body === undefined ? { status } : { status, body };
}

const NOT_FOUND = reply(404);
const SOURCE_UNKNOWN = reply(422, {
  error_type: "request_invalid",
  error_codes: ["source_id_unknown"],
});

interface Route {
  method: string;
  path: RegExp;
  handle: (provider: Provider, request: Routed) => Reply;
}

/** The routes the chain calls, each with the handler that answers it. */
const ROUTES: readonly Route[] = [
  {
    method: "POST",
    path: /^\/customers$/,
    handle: (p, r) => p.createCustomer(r),
  },
  {
    method: "GET",
    path: /^\/customers\/(\w+)$/,
    handle: (p, r) => p.getCustomer(r),
  },
  {
    method: "PATCH",
    path: /^\/customers\/(\w+)$/,
    handle: (p, r) => p.patchCustomer(r),
  },
  {
    method: "GET",
    path: /^\/instruments\/(\w+)$/,
    handle: (p, r) => p.getInstrument(r),
  },
  {
    method: "PATCH",
    path: /^\/instruments\/(\w+)$/,
    handle: (p, r) => p.linkInstrument(r),
  },
  {
    method: "DELETE",
    path: /^\/instruments\/(\w+)$/,
    handle: (p, r) => p.deleteInstrument(r),
  },
  {
    method: "POST",
    path: /^\/payments$/,
    handle: (p, r) => p.createPayment(r),
  },
  {
    method: "GET",
    path: /^\/payments\/(\w+)$/,
    handle: (p, r) => p.getPayment(r),
  },
];

export class Provider {
  readonly customerId: string;
  readonly cards: Card[] = [];
  readonly trace: string[] = [];
  readonly broken = new Map<Rule, Breakage>();
  readonly gaps: string[] = [];
  callerKeys: Metadata = {};
  private customer: { email: string; metadata: Metadata } | undefined;
  private readonly instruments = new Map<string, { customer: string }>();
  private readonly payments = new Map<string, StoredPayment>();
  private readonly firstRecord = new Map<string, string>();
  private readonly aliases = new Map<string, string>();
  private readonly sequence: string[] = [];
  private readonly counts = {
    chained: 0,
    unchained: 0,
    detachedRecorded: 0,
    lists: 0,
  };
  private readonly semantics: Semantics;
  private charges = 0;
  private events = 0;

  constructor(semantics: Semantics, run: number) {
    this.semantics = semantics;
    this.customerId = PaddedId("cus", `run${run}`);
    this.aliases.set(this.customerId, "cus");
  }

  /** Opens `count` cards; a card's `ready` settles when its saving payment reaches Checkout.com. */
  expectCards(count: number): void {
    for (let index = 0; index < count; index += 1) {
      let created = (): void => undefined;
      const ready = new Promise<void>((resolve) => {
        created = resolve;
      });
      this.cards.push({ name: `card${index + 1}`, ready, created });
    }
  }

  /** The card's stored instrument, once its saving payment reached Checkout.com. */
  instrumentOf(card: number): string {
    const instrument = this.cards[card].instrument;
    if (instrument === undefined)
      throw new ModelGap(`card${card + 1} has no instrument yet`);
    return instrument;
  }

  /** The card's saving payment, once it reached Checkout.com. */
  paymentOf(card: number): string {
    const payment = this.cards[card].payment;
    if (payment === undefined)
      throw new ModelGap(`card${card + 1} has no payment yet`);
    return payment;
  }

  alias(id: string | undefined): string {
    return id === undefined ? "none" : (this.aliases.get(id) ?? id);
  }

  breaks(rule: Rule, detail: string): void {
    if (this.broken.has(rule)) return;
    this.broken.set(rule, { states: this.events + 1, detail });
    this.trace.push(`  ! ${rule}: ${detail}`);
  }

  /** Records a {@link ModelGap} the module or the run may swallow, so the run still fails as a tool error. */
  gap(error: ModelGap): void {
    this.gaps.push(error.message);
  }

  note(line: string): void {
    this.trace.push(`  · ${line}`);
  }

  /** Answers one request, as one step, then checks the step rules. */
  answer(request: Request, op: Operation): Reply {
    const route = ROUTES.find(
      ({ method, path }) =>
        method === request.method && path.test(request.path),
    );
    if (!route)
      throw new ModelGap(
        `the model does not answer ${request.method} ${request.path}`,
      );
    const [, id = ""] = route.path.exec(request.path) ?? [];
    this.events += 1;
    this.sequence.push(op.label);
    const answered = route.handle(this, { ...request, id, op });
    const shown = request.path.split("/").map((part) => this.alias(part));
    this.trace.push(
      `${String(this.events).padStart(3)} ${op.label}: ${request.method} ${shown.join("/")} -> ${answered.status}${this.describe()}`,
    );
    this.checkStep();
    return answered;
  }

  /** The payer passes the 3DS challenge of `card`'s saving payment: one step, outside the module. */
  payerPasses(card: number): void {
    const id = this.paymentOf(card);
    const payment = this.payments.get(id);
    if (!payment?.inThreeDs) return;
    payment.inThreeDs = false;
    this.events += 1;
    this.trace.push(
      `${String(this.events).padStart(3)} payer passes 3DS on ${this.alias(id)}`,
    );
    this.checkStep();
  }

  /** At quiescence: no record names a card the customer no longer has. */
  finish(): void {
    if (!this.customer) return;
    for (const instrument of RecordedInstruments(this.customer.metadata)) {
      if (!this.isLinked(instrument)) {
        this.breaks(
          "NoRecordOutlivesInstrument",
          `at quiescence the record for ${this.alias(instrument)} names a card the customer no longer has`,
        );
      }
    }
  }

  /** No request is left to answer, yet `pending` operations never settled. */
  deadlock(pending: string[]): void {
    this.breaks(
      "Settles",
      `no request is left to answer, yet ${pending.join(", ")} never settled`,
    );
  }

  /** A payment method list answers the cards and save times the customer held when it was read. */
  checkList(op: Operation, methods: { id: string; createdAt: number }[]): void {
    this.counts.lists += 1;
    const [read] = op.reads;
    if (!read)
      throw new ModelGap(`${op.label} answered without reading the customer`);
    const expected = read.instruments.map((id) => ({
      id,
      createdAt: RecordOf(read.metadata, id)?.savedAt ?? 0,
    }));
    const isSame =
      methods.length === expected.length &&
      expected.every(({ id, createdAt }) =>
        methods.some(
          (method) => method.id === id && method.createdAt === createdAt,
        ),
      );
    const unauthenticated = methods.filter(({ id }) =>
      [...this.payments.values()].some(
        (payment) => payment.instrument === id && payment.inThreeDs,
      ),
    );
    if (unauthenticated.length > 0) {
      this.breaks(
        "ListsOnlyAuthenticated",
        `${op.label} answered [${this.listed(unauthenticated)}], whose saving payment still waits for its payer`,
      );
    }
    if (!isSame) {
      this.breaks(
        "ListMatchesRecord",
        `${op.label} answered [${this.listed(methods)}] where the read held [${this.listed(expected)}]`,
      );
    }
  }

  /** What this run reached, for the coverage line. */
  coverage(): Coverage {
    const isInterleaved = this.sequence.some((label, index) => {
      const next = this.sequence.indexOf(label, index + 1);
      return next > index + 1;
    });
    const metadata = this.customer?.metadata ?? {};
    const recorded = this.cards.filter(
      ({ instrument }) =>
        instrument !== undefined && this.firstRecord.has(instrument),
    );
    const unrecorded = this.cards.filter(
      ({ instrument }) =>
        instrument !== undefined &&
        this.isLinked(instrument) &&
        !RecordOf(metadata, instrument),
    );
    const inThreeDs = unrecorded.filter(
      ({ payment }) =>
        payment !== undefined && this.payments.get(payment)?.inThreeDs,
    );
    return {
      ...this.counts,
      interleaved: isInterleaved ? 1 : 0,
      records: recorded.length,
      recordedAfter3ds: recorded.filter(({ flow }) => flow === "3ds").length,
      unrecordedIn3ds: inThreeDs.length,
      unrecordedAuthorized: unrecorded.length - inThreeDs.length,
    };
  }

  createCustomer({ body }: Routed): Reply {
    this.checkSent(body.metadata, "POST /customers");
    this.customer = { email: body.email ?? "", metadata: { ...body.metadata } };
    this.noteRecords();
    return reply(201, { id: this.customerId });
  }

  getCustomer({ id, op }: Routed): Reply {
    const customer = this.customerOr404(id);
    if (!customer) return NOT_FOUND;
    const instruments = this.linked();
    op.reads.push({ metadata: { ...customer.metadata }, instruments });
    return reply(200, {
      id,
      email: customer.email,
      metadata: { ...customer.metadata },
      instruments: instruments.map((instrument) => ({
        id: instrument,
        type: "card",
      })),
    });
  }

  patchCustomer({ body, id }: Routed): Reply {
    const customer = this.customerOr404(id);
    if (!customer) return NOT_FOUND;
    if (body.metadata !== undefined) {
      this.checkSent(body.metadata, "PATCH /customers");
      customer.metadata =
        this.semantics === "replace"
          ? { ...body.metadata }
          : { ...customer.metadata, ...body.metadata };
    }
    this.noteRecords();
    return reply(204);
  }

  /** As the sandbox answers it: the linked customer when there is one, 404 once deleted. */
  getInstrument({ id }: Routed): Reply {
    const instrument = this.instruments.get(id);
    if (!instrument) return NOT_FOUND;
    return instrument.customer
      ? reply(200, { id, type: "card", customer: { id: instrument.customer } })
      : reply(200, { id, type: "card" });
  }

  linkInstrument({ body, id }: Routed): Reply {
    const instrument = this.instruments.get(id);
    if (!instrument) return NOT_FOUND;
    if (!body.customer)
      throw new ModelGap("PATCH /instruments without a customer");
    instrument.customer = body.customer.id;
    return reply(200, { type: "card" });
  }

  deleteInstrument({ id }: Routed): Reply {
    if (!this.instruments.has(id)) return NOT_FOUND;
    if (this.customer && RecordOf(this.customer.metadata, id))
      this.counts.detachedRecorded += 1;
    this.instruments.delete(id);
    return reply(204);
  }

  createPayment(request: Routed): Reply {
    const { body, op } = request;
    if (body.source?.type === "token" && op.kind === "save")
      return this.savingPayment(body, op);
    if (body.source?.type === "id" && body.source.id !== undefined) {
      return this.storedCardPayment(body, op, body.source.id);
    }
    throw new ModelGap(`${op.label} sent a payment the model does not answer`);
  }

  getPayment({ id }: Routed): Reply {
    return this.payments.has(id) ? reply(200, this.view(id)) : NOT_FOUND;
  }

  private savingPayment(body: Body, op: Operation & { kind: "save" }): Reply {
    const card = this.cards[op.card];
    const instrument = PaddedId("src", card.name);
    const id = PaddedId("pay", `save${op.card + 1}`);
    this.aliases.set(instrument, card.name).set(id, `save${op.card + 1}`);
    this.instruments.set(instrument, { customer: body.customer?.id ?? "" });
    const inThreeDs = op.flow === "3ds";
    this.payments.set(id, { instrument, metadata: body.metadata, inThreeDs });
    card.flow = op.flow;
    card.instrument = instrument;
    card.payment = id;
    card.created();
    if (!inThreeDs) return reply(201, this.view(id));
    const { source: _inThreeDs, ...accepted } = this.view(id);
    return reply(202, accepted);
  }

  private storedCardPayment(
    body: Body,
    op: Operation,
    instrument: string,
  ): Reply {
    if (body.merchant_initiated === true) this.checkChain(op, body, instrument);
    if (!this.instruments.has(instrument)) return SOURCE_UNKNOWN;
    const isUnauthenticated = [...this.payments.values()].some(
      (payment) => payment.instrument === instrument && payment.inThreeDs,
    );
    if (body.merchant_initiated === true && isUnauthenticated) {
      this.breaks(
        "ChargesOnlyAuthenticated",
        `${op.label} charged ${this.alias(instrument)} off-session while its saving payment still waits for its payer`,
      );
    }
    this.charges += 1;
    const id = PaddedId("pay", `charge${this.charges}`);
    this.aliases.set(id, `charge${this.charges}`);
    this.payments.set(id, {
      instrument,
      metadata: body.metadata,
      inThreeDs: false,
    });
    return reply(201, this.view(id));
  }

  /** A payment as Checkout.com shows it: in 3DS, a redirect and a source with no id. */
  private view(id: string): JsonObject {
    const payment = this.payments.get(id);
    if (!payment) throw new ModelGap(`no payment ${id}`);
    const self = { href: `${BASE_URL}/payments/${id}` };
    const shown: JsonObject = {
      id,
      amount: 1000,
      currency: "EUR",
      customer: { id: this.customerId },
    };
    if (payment.metadata) shown.metadata = payment.metadata;
    if (payment.inThreeDs) {
      return {
        ...shown,
        status: "Pending",
        source: { type: "card" },
        _links: { self, redirect: { href: `${BASE_URL}/3ds/${id}` } },
      };
    }
    return {
      ...shown,
      status: "Authorized",
      approved: true,
      source: { id: payment.instrument, type: "card" },
      _links: { self },
    };
  }

  private checkChain(op: Operation, body: Body, instrument: string): void {
    this.counts[
      body.previous_payment_id === undefined ? "unchained" : "chained"
    ] += 1;
    const [read] = op.reads;
    const expected = read
      ? RecordOf(read.metadata, instrument)?.payment
      : undefined;
    if (body.previous_payment_id !== expected) {
      this.breaks(
        "ChainMatchesRecord",
        `${op.label} sent previous_payment_id ${this.alias(body.previous_payment_id)} where the record it read names ${this.alias(expected)}`,
      );
    }
  }

  private checkSent(metadata: Metadata | undefined, what: string): void {
    const pairs = Object.keys(metadata ?? {}).length;
    if (pairs > PAIR_LIMIT)
      this.breaks(
        "MetadataLimit",
        `the module sent ${what} with ${pairs} pairs`,
      );
  }

  private checkStep(): void {
    if (!this.customer) return;
    const metadata = this.customer.metadata;
    const pairs = Object.keys(metadata).length;
    if (pairs > PAIR_LIMIT)
      this.breaks("MetadataLimit", `the customer holds ${pairs} pairs`);
    for (const [key, value] of Object.entries(this.callerKeys)) {
      const kept = Object.hasOwn(metadata, key) ? metadata[key] : undefined;
      if (kept !== value)
        this.breaks(
          "CallerKeysKept",
          `caller key ${key} reads ${kept ?? "nothing"}`,
        );
    }
    for (const [instrument, payment] of this.firstRecord) {
      const kept = RecordOf(metadata, instrument)?.payment;
      if (this.isLinked(instrument) && kept !== payment) {
        this.breaks(
          "RecordKept",
          `${this.alias(instrument)} is still saved but its record now names ${this.alias(kept)}, not ${this.alias(payment)}`,
        );
      }
    }
  }

  private noteRecords(): void {
    const metadata = this.customer?.metadata ?? {};
    for (const instrument of RecordedInstruments(metadata)) {
      const record = RecordOf(metadata, instrument);
      if (record && !this.firstRecord.has(instrument))
        this.firstRecord.set(instrument, record.payment);
    }
  }

  private describe(): string {
    if (!this.customer) return "";
    const metadata = this.customer.metadata;
    const records = RecordedInstruments(metadata).map(
      (instrument) =>
        `${this.alias(instrument)}=${this.alias(RecordOf(metadata, instrument)?.payment)}`,
    );
    const cards = this.linked().map((id) => this.alias(id));
    return ` [${Object.keys(metadata).length} pairs; records ${records.join(" ") || "none"}; cards ${cards.join(" ") || "none"}]`;
  }

  private listed(methods: { id: string; createdAt: number }[]): string {
    return methods
      .map(
        ({ id, createdAt }) =>
          `${this.alias(id)}@${createdAt === 0 ? 0 : "record"}`,
      )
      .sort()
      .join(" ");
  }

  private customerOr404(
    id: string,
  ): { email: string; metadata: Metadata } | undefined {
    return id === this.customerId ? this.customer : undefined;
  }

  private linked(): string[] {
    return [...this.instruments.entries()]
      .filter(([, instrument]) => instrument.customer === this.customerId)
      .map(([id]) => id);
  }

  private isLinked(id: string): boolean {
    return this.instruments.get(id)?.customer === this.customerId;
  }
}
