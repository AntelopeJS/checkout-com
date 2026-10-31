import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { CkoPayment } from "../implementations/payment/cko-types";
import { CkoApiError, CkoClient } from "../implementations/payment/http";

interface Answer {
  status: number;
  body: string;
}

const READ = { method: "GET" as const, path: "/payments/pay_suite" };

function isTcpAddress(
  address: string | AddressInfo | null,
): address is AddressInfo {
  return typeof address === "object" && address !== null;
}

async function rejection(promise: Promise<unknown>): Promise<CkoApiError> {
  const cause = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  assert.ok(cause instanceof CkoApiError, "rejects with a CkoApiError");
  return cause;
}

describe("[checkout-com] client, on answers Checkout.com does not document", () => {
  let server: Server;
  let client: CkoClient;
  let next: Answer = { status: 200, body: "{}" };

  before(async () => {
    server = createServer((_request, response) => {
      response.writeHead(next.status);
      response.end(next.body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(isTcpAddress(address));
    client = new CkoClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      secretKey: "sk_sbox_suite",
      timeoutMs: 5_000,
    });
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports an error body whose error_codes is not a list as Checkout.com's error status", async () => {
    next = { status: 400, body: '{"error_type":"bad","error_codes":"abc"}' };
    const error = await rejection(client.send<CkoPayment>(READ));
    assert.equal(error.status, 400);
    assert.equal(error.errorType, "bad");
    assert.deepEqual(error.errorCodes, []);
  });

  it("refuses a successful answer that is not JSON", async () => {
    next = { status: 200, body: "<html>gateway</html>" };
    assert.equal((await rejection(client.send<CkoPayment>(READ))).status, 200);
  });

  it("refuses an empty successful answer where a resource is expected", async () => {
    next = { status: 200, body: "" };
    assert.equal((await rejection(client.send<CkoPayment>(READ))).status, 200);
  });

  it("refuses a JSON answer that is not the resource asked for", async () => {
    next = { status: 201, body: "[1,2]" };
    assert.equal((await rejection(client.send<CkoPayment>(READ))).status, 201);
  });
});
