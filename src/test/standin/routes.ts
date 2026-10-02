import type { Handler, Route } from "./server";
import { type SimContext, SimError } from "./context";
import { CreateHostedPayment, GetHostedPayment } from "./hosted";
import {
  Capture,
  CreatePayment,
  GetActions,
  GetPayment,
  Refund,
  Void,
} from "./payments";
import {
  CreateCustomer,
  CreateInstrument,
  CreateToken,
  DeleteCustomer,
  DeleteInstrument,
  GetCustomer,
  GetInstrument,
  UpdateCustomer,
  UpdateInstrument,
} from "./vault";

const SEGMENT = "([^/]+)";

function guarded(handler: Handler): Handler {
  return async (request, params) => {
    try {
      return await handler(request, params);
    } catch (error) {
      if (error instanceof SimError) return error.reply;
      throw error;
    }
  };
}

function route(
  method: string,
  path: string,
  handler: Handler,
  options: Partial<Route> = {},
): Route {
  return {
    method,
    pattern: new RegExp(`^${path.split("{}").join(SEGMENT)}$`),
    handler: guarded(handler),
    ...options,
  };
}

const idempotent = { isIdempotent: true };

/**
 * The endpoints the module uses, and the one idempotency rule Checkout.com
 * documents: `Cko-Idempotency-Key` is honoured on `/payments` and its capture,
 * void and refund actions, and nowhere else here.
 */
export function Routes(context: SimContext): Route[] {
  return [
    route("POST", "/tokens", (request) => CreateToken(context, request), {
      isPublic: true,
    }),
    route(
      "POST",
      "/payments",
      (request) => CreatePayment(context, request),
      idempotent,
    ),
    route("GET", "/payments/{}", (_r, [id]) => GetPayment(context, id)),
    route("GET", "/payments/{}/actions", (_r, [id]) => GetActions(context, id)),
    route(
      "POST",
      "/payments/{}/captures",
      (request, [id]) => Capture(context, request, id),
      idempotent,
    ),
    route(
      "POST",
      "/payments/{}/voids",
      (_r, [id]) => Void(context, id),
      idempotent,
    ),
    route(
      "POST",
      "/payments/{}/refunds",
      (request, [id]) => Refund(context, request, id),
      idempotent,
    ),
    route("POST", "/instruments", (request) =>
      CreateInstrument(context, request),
    ),
    route("GET", "/instruments/{}", (_r, [id]) => GetInstrument(context, id)),
    route("PATCH", "/instruments/{}", (request, [id]) =>
      UpdateInstrument(context, request, id),
    ),
    route("DELETE", "/instruments/{}", (_r, [id]) =>
      DeleteInstrument(context, id),
    ),
    route("POST", "/customers", (request) => CreateCustomer(context, request)),
    route("GET", "/customers/{}", (_r, [id]) => GetCustomer(context, id)),
    route("PATCH", "/customers/{}", (request, [id]) =>
      UpdateCustomer(context, request, id),
    ),
    route("DELETE", "/customers/{}", (_r, [id]) => DeleteCustomer(context, id)),
    route("POST", "/hosted-payments", (request) =>
      CreateHostedPayment(context, request),
    ),
    route("GET", "/hosted-payments/{}", (_r, [id]) =>
      GetHostedPayment(context, id),
    ),
  ];
}
