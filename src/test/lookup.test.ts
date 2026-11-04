import assert from "node:assert/strict";

import { LookUp } from "../implementations/payment/lookup";

describe("[checkout-com] lookups", () => {
  it("answers the keys a table has and nothing for the ones it only inherits", () => {
    const table = { captured: "paid", declined: "failed" };
    assert.equal(LookUp(table, "declined"), "failed");
    assert.equal(LookUp(table, "voided"), undefined);
    for (const inherited of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
    ]) {
      assert.equal(LookUp(table, inherited), undefined, inherited);
    }
  });
});
