/**
 * One generated run: a customer created with caller metadata, then saving
 * payments and the operations that follow them, all started at once. Every
 * request, every operation start and every 3DS step of the payer is a task of
 * a fast-check scheduler, so the scheduler picks their interleaving.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate as nextTurn } from "node:timers/promises";
import fc, { type Arbitrary, type Scheduler } from "fast-check";

import type * as Payment from "../../../src/implementations/payment/index.ts";
import type { Flow, Operation, Reply, Semantics } from "./domain.mts";
import { Provider } from "./provider.mts";
import { IsModelGap, IsText, IsUrl, ModelGap, ParseBody } from "./wire.mts";

/** The module functions a run drives. */
export type Chain = Pick<
  typeof Payment,
  | "CreateCustomer"
  | "CreatePayment"
  | "GetPayment"
  | "ListPaymentMethods"
  | "DetachPaymentMethod"
>;

const MAX_CARDS = 4;
const MAX_OPS = 8;
const AMOUNT = { value: 1000, currency: "EUR" };
const RETURN_URL = "https://shop.invalid/return";

/** The generated input of one run. */
export const Scenarios = fc.record({
  callerKeys: fc.oneof(
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 }) },
    { weight: 3, arbitrary: fc.integer({ min: 15, max: 19 }) },
  ),
  saves: fc.array(fc.constantFrom<Flow>("frictionless", "3ds"), {
    minLength: 1,
    maxLength: MAX_CARDS,
  }),
  ops: fc.array(
    fc.oneof(
      {
        weight: 4,
        arbitrary: fc.record({
          kind: fc.constantFrom("return", "read", "charge", "detach"),
          card: fc.nat({ max: MAX_CARDS - 1 }),
        }),
      },
      { weight: 1, arbitrary: fc.constant<{ kind: "list" }>({ kind: "list" }) },
    ),
    { maxLength: MAX_OPS },
  ),
});

export type Scenario = typeof Scenarios extends Arbitrary<infer T> ? T : never;

/** The request each operation makes is answered within that operation's context. */
const operation = new AsyncLocalStorage<Operation>();

function respond(answered: Reply): Response {
  const body =
    answered.body === undefined ? null : JSON.stringify(answered.body);
  return new Response(body, { status: answered.status });
}

/** Routes the module's `fetch` and its error log to `provider` for one run; returns the undo. */
function install(provider: Provider, scheduler: Scheduler): () => void {
  const fetchBefore = globalThis.fetch;
  const writeBefore = process.stderr.write.bind(process.stderr);
  globalThis.fetch = async (url, init) => {
    try {
      const op = operation.getStore();
      if (!op || !IsUrl(url))
        throw new ModelGap("a request left outside an operation");
      const body = init?.body;
      const request = {
        method: init?.method ?? "GET",
        path: url.pathname,
        body: ParseBody(IsText(body) ? body : undefined),
      };
      await scheduler.schedule(
        Promise.resolve(),
        `${op.label} ${request.method} ${request.path}`,
      );
      return respond(provider.answer(request, op));
    } catch (error) {
      if (IsModelGap(error)) provider.gap(error);
      throw error;
    }
  };
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    const said = Buffer.from(chunk).toString("utf8").trim();
    provider.note(
      `module: ${said.replace(/\b\w+_\w{26}\b/g, (id) => provider.alias(id))}`,
    );
    return true;
  };
  return () => {
    globalThis.fetch = fetchBefore;
    process.stderr.write = writeBefore;
  };
}

function plan(scenario: Scenario): Operation[] {
  const running = (label: string) => ({ label, reads: [], settled: false });
  const saves: Operation[] = scenario.saves.map((flow, card) => ({
    ...running(`#${card + 1} save card${card + 1}`),
    kind: "save",
    card,
    flow,
  }));
  const ops: Operation[] = scenario.ops.map((op, index) => {
    const label = `#${saves.length + index + 1}`;
    if (op.kind === "list")
      return { ...running(`${label} list`), kind: "list" };
    const card = op.card % saves.length;
    return {
      ...running(`${label} ${op.kind} card${card + 1}`),
      kind: op.kind,
      card,
    };
  });
  return [...saves, ...ops];
}

async function call(
  module: Chain,
  provider: Provider,
  scheduler: Scheduler,
  op: Operation,
): Promise<void> {
  switch (op.kind) {
    case "create":
      throw new ModelGap("the customer is created before the operations start");
    case "save":
      await module.CreatePayment(
        {
          amount: AMOUNT,
          reference: op.label,
          paymentMethod: `tok_${provider.cards[op.card].name}`,
          customer: provider.customerId,
          savePaymentMethod: true,
          returnUrl: RETURN_URL,
        },
        op.label,
      );
      return;
    case "return":
      await scheduler.schedule(Promise.resolve(), `${op.label} payer`);
      provider.payerPasses(op.card);
      await module.GetPayment(provider.paymentOf(op.card));
      return;
    case "read":
      await module.GetPayment(provider.paymentOf(op.card));
      return;
    case "charge":
      await module.CreatePayment(
        {
          amount: AMOUNT,
          reference: op.label,
          paymentMethod: provider.instrumentOf(op.card),
          customer: provider.customerId,
          offSession: true,
        },
        op.label,
      );
      return;
    case "detach":
      await module.DetachPaymentMethod(
        provider.instrumentOf(op.card),
        op.label,
      );
      return;
    case "list":
      provider.checkList(
        op,
        await module.ListPaymentMethods(provider.customerId),
      );
  }
}

/** Starts `op` once its card exists, at a moment the scheduler picks. */
async function launch(
  module: Chain,
  provider: Provider,
  scheduler: Scheduler,
  op: Operation,
): Promise<void> {
  try {
    const isCardOp =
      op.kind === "return" ||
      op.kind === "read" ||
      op.kind === "charge" ||
      op.kind === "detach";
    if (isCardOp) await provider.cards[op.card].ready;
    await scheduler.schedule(Promise.resolve(), `${op.label} start`);
    provider.note(
      `${op.label} starts${op.kind === "save" ? ` (${op.flow})` : ""}`,
    );
    await operation.run(op, () => call(module, provider, scheduler, op));
  } catch (error) {
    if (IsModelGap(error)) provider.gap(error);
    throw error;
  } finally {
    op.settled = true;
  }
}

/**
 * Releases one scheduled task at a time until every operation settled. Each
 * release waits a full turn first, so every operation the last answer woke has
 * scheduled its next request; no task left with operations still open is a
 * deadlock.
 */
async function drive(
  provider: Provider,
  scheduler: Scheduler,
  ops: Operation[],
  launched: Promise<void>[],
): Promise<void> {
  let isDone = false;
  const all = Promise.allSettled(launched).then(() => {
    isDone = true;
  });
  for (;;) {
    await nextTurn();
    if (isDone) return all;
    if (scheduler.count() === 0) {
      provider.deadlock(
        ops.filter(({ settled }) => !settled).map(({ label }) => label),
      );
      return;
    }
    await scheduler.waitNext(1);
  }
}

let runs = 0;

/** Runs `scenario` against the module with `semantics` for PATCH; the returned provider holds what broke. */
export async function RunScenario(
  module: Chain,
  scenario: Scenario,
  scheduler: Scheduler,
  semantics: Semantics,
): Promise<Provider> {
  runs += 1;
  const provider = new Provider(semantics, runs);
  provider.expectCards(scenario.saves.length);
  provider.callerKeys = Object.fromEntries(
    Array.from({ length: scenario.callerKeys }, (_, index) => [
      `caller_${String(index).padStart(2, "0")}`,
      `value ${index}`,
    ]),
  );
  const restore = install(provider, scheduler);
  try {
    const create: Operation = {
      kind: "create",
      label: "#0 create",
      reads: [],
      settled: false,
    };
    const created = operation
      .run(create, () =>
        module.CreateCustomer(
          { email: "payer@shop.invalid", metadata: provider.callerKeys },
          create.label,
        ),
      )
      .finally(() => {
        create.settled = true;
      });
    await drive(provider, scheduler, [create], [created.then(() => undefined)]);
    if (!provider.broken.has("Settles")) {
      const ops = plan(scenario);
      await drive(
        provider,
        scheduler,
        ops,
        ops.map((op) => launch(module, provider, scheduler, op)),
      );
    }
    if (provider.gaps.length > 0) throw new ModelGap(provider.gaps.join("; "));
    if (!provider.broken.has("Settles")) provider.finish();
    return provider;
  } finally {
    restore();
  }
}
