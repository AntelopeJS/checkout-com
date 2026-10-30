import assert from "node:assert/strict";

import { IsJsonValue, ParseJson } from "../implementations/payment/json";

describe("[checkout-com] JSON", () => {
  it("parses text to the data JSON.parse returns, an own __proto__ key included", () => {
    assert.deepEqual(ParseJson('{"a":[1,"b",null,true],"c":{"d":1.5}}'), {
      a: [1, "b", null, true],
      c: { d: 1.5 },
    });
    assert.equal(ParseJson("null"), null);
    assert.equal(
      JSON.stringify(ParseJson('{"__proto__":{"x":1}}')),
      '{"__proto__":{"x":1}}',
    );
    assert.throws(() => ParseJson("{nope"), SyntaxError);
  });

  it("accepts only JSON data, all the way down", () => {
    assert.equal(IsJsonValue({ a: [1, { b: null }], c: "d", e: false }), true);
    assert.equal(IsJsonValue(Object.create(null)), true);
    for (const foreign of [
      undefined,
      () => 1,
      Symbol("s"),
      new Date(0),
      new Map(),
      { nested: [new Date(0)] },
      { nested: { deep: undefined } },
    ]) {
      assert.equal(IsJsonValue(foreign), false);
    }
  });
});
