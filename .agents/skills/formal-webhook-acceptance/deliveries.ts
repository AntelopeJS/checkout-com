import fc from "fast-check";

import { type Delivery } from "./oracle.ts";
import { signatureSpec, signatureValue } from "./signatures.ts";

type ValueOf<Source> = Source extends fc.Arbitrary<infer Value> ? Value : never;
type HeaderValue = string | string[] | undefined;
type Entry = [string, HeaderValue];

const NON_UTF8 = [[0xff, 0xfe, 0xfd], [0xc3, 0x28], [0x80], [0xed, 0xa0, 0x80], [0x00, 0xff, 0x00]];
const NOISE_NAMES = [
  "content-type",
  "x-request-id",
  "x-cko-signature",
  "cko-signature-extra",
  "authorization-id",
  "__proto__",
  "constructor",
  "cko-signature ",
];
const SET_TOKENS = ["Bearer abc123", "Basic dXNlcjpwYXNz", "  spaced  ", "Straße☃", "t"];
const AUTHORIZATION_KINDS = [
  "exact",
  "exact",
  "wrong",
  "prefix",
  "suffix",
  "padded",
  "swapped",
  "scheme",
  "empty",
  "arbitrary",
] as const;

const key = fc.oneof(
  { weight: 2, arbitrary: fc.constant("") },
  { weight: 4, arbitrary: fc.string({ minLength: 1, maxLength: 24, unit: "binary-ascii" }) },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 24, unit: "grapheme" }) },
  { weight: 2, arbitrary: fc.string({ minLength: 65, maxLength: 100, unit: "binary" }) },
);

const bodyBytes = fc.oneof(
  { weight: 1, arbitrary: fc.constant<number[]>([]) },
  { weight: 3, arbitrary: fc.array(fc.nat(255), { maxLength: 48 }) },
  { weight: 2, arbitrary: fc.constantFrom(...NON_UTF8) },
  { weight: 2, arbitrary: fc.json().map((text) => [...Buffer.from(text)]) },
);

const bodyLayout = fc.record({
  kind: fc.constantFrom("uint8array", "buffer", "view"),
  before: fc.nat(8),
  after: fc.nat(8),
  filler: fc.nat(255),
});

function bodyOf(bytes: number[], layout: ValueOf<typeof bodyLayout>): Uint8Array {
  if (layout.kind === "uint8array") {
    return Uint8Array.from(bytes);
  }
  if (layout.kind === "buffer") {
    return Buffer.from(bytes);
  }
  const store = new Uint8Array(layout.before + bytes.length + layout.after).fill(layout.filler);
  store.set(bytes, layout.before);
  return store.subarray(layout.before, layout.before + bytes.length);
}

const authorization = fc.oneof(
  { weight: 3, arbitrary: fc.constant<string | undefined>(undefined) },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 20, unit: "binary-ascii" }) },
  { weight: 2, arbitrary: fc.constantFrom(...SET_TOKENS) },
);

const authorizationSpec = fc.record({
  kind: fc.constantFrom(...AUTHORIZATION_KINDS),
  text: fc.string({ maxLength: 20 }),
});

function swapCase(text: string): string {
  return Array.from(text)
    .map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
    .join("");
}

function authorizationValue(
  spec: ValueOf<typeof authorizationSpec>,
  configured: string | undefined,
): string {
  const secret = configured ?? "token";
  switch (spec.kind) {
    case "exact":
      return secret;
    case "wrong":
      return spec.text === secret ? `${secret}!` : spec.text;
    case "prefix":
      return secret.slice(0, -1);
    case "suffix":
      return `${secret}x`;
    case "padded":
      return ` ${secret} `;
    case "swapped":
      return swapCase(secret);
    case "scheme":
      return `Bearer ${secret}`;
    case "empty":
      return "";
    case "arbitrary":
      return spec.text;
  }
}

function inverseCase(name: string): string {
  return name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();
}

const carrier = fc.record({
  array: fc.boolean(),
  pick: fc.nat(2),
  reverse: fc.boolean(),
  nullPrototype: fc.boolean(),
});

function carried(name: string, values: string[], placement: ValueOf<typeof carrier>): Entry[] {
  if (values.length === 0) {
    const absent: Entry[][] = [[], [[name, undefined]], [[name, []]]];
    return absent[placement.pick] ?? [];
  }
  const [first = "", ...rest] = values;
  if (rest.length === 0) {
    return [[name, placement.array ? values : first]];
  }
  if (placement.array) {
    return [[name, values]];
  }
  return [
    [name, first],
    [inverseCase(name), rest.length === 1 ? (rest[0] ?? "") : rest],
  ];
}

const caseVariant = (text: string) =>
  fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((flags) =>
      text.split("").map((char, at) => (flags[at] ? char.toUpperCase() : char.toLowerCase())).join(""),
    );

function valueCount<Value>(arbitrary: fc.Arbitrary<Value>): fc.Arbitrary<Value[]> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant<Value[]>([]) },
    { weight: 8, arbitrary: fc.array(arbitrary, { minLength: 1, maxLength: 1 }) },
    { weight: 2, arbitrary: fc.array(arbitrary, { minLength: 2, maxLength: 3 }) },
  );
}

const noise = fc.array(fc.tuple(fc.constantFrom(...NOISE_NAMES), fc.string({ maxLength: 12 })), {
  maxLength: 3,
});

const spec = fc.record({
  bytes: bodyBytes,
  layout: bodyLayout,
  key,
  authorization,
  signatures: valueCount(signatureSpec),
  signatureName: caseVariant("cko-signature"),
  signatureCarrier: carrier,
  authorizations: valueCount(authorizationSpec),
  authorizationName: caseVariant("authorization"),
  authorizationCarrier: carrier,
  noise,
});

function headersOf(entries: Entry[], nullPrototype: boolean): Delivery["headers"] {
  const headers: Delivery["headers"] = Object.fromEntries(entries);
  if (nullPrototype) {
    Object.setPrototypeOf(headers, null);
  }
  return headers;
}

function build(generated: ValueOf<typeof spec>): Delivery {
  const body = bodyOf(generated.bytes, generated.layout);
  const signatures = generated.signatures.map((item) => signatureValue(item, body, generated.key));
  const authorizations = generated.authorizations.map((item) =>
    authorizationValue(item, generated.authorization),
  );
  const entries = [
    ...carried(generated.signatureName, signatures, generated.signatureCarrier),
    ...carried(generated.authorizationName, authorizations, generated.authorizationCarrier),
    ...generated.noise,
  ];
  const ordered = generated.signatureCarrier.reverse ? entries.reverse() : entries;
  return {
    body,
    key: generated.key,
    authorization: generated.authorization,
    headers: headersOf(ordered, generated.signatureCarrier.nullPrototype),
  };
}

/** Deliveries as the module receives them: raw body, header map, signature key and `Authorization` value. */
export const deliveries: fc.Arbitrary<Delivery> = spec.map(build);
