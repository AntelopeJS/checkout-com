import { isObject } from "./raw";

export interface Target {
  baseUrl: string;
  secretKey: string;
  publicKey?: string;
  processingChannelId: string;
}

interface TokenResponse {
  token: string;
}

interface InstrumentResponse {
  id: string;
}

interface TokenRequest {
  type: "card";
  number: string;
  expiry_month: number;
  expiry_year: number;
  cvv: string;
}

interface InstrumentRequest {
  type: "token";
  token: string;
  customer?: { id: string };
}

function isTokenResponse(body: unknown): body is TokenResponse {
  return isObject(body) && "token" in body && typeof body.token === "string";
}

function isInstrumentResponse(body: unknown): body is InstrumentResponse {
  return isObject(body) && "id" in body && typeof body.id === "string";
}

function testCard(cardNumber: string): TokenRequest {
  return {
    type: "card",
    number: cardNumber,
    expiry_month: TEST_EXPIRY_MONTH,
    expiry_year: new Date().getFullYear() + TEST_EXPIRY_YEARS_AHEAD,
    cvv: "100",
  };
}

const TEST_EXPIRY_MONTH = 12;
const TEST_EXPIRY_YEARS_AHEAD = 3;

async function post<T>(
  target: Target,
  path: string,
  key: string,
  body: TokenRequest | InstrumentRequest,
  isExpected: (answer: unknown) => answer is T,
): Promise<T> {
  const response = await fetch(new URL(path, target.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${path} answered ${response.status}: ${await response.text()}`,
    );
  }
  const answer: unknown = await response.json();
  if (!isExpected(answer)) {
    throw new Error(`${path} answered an unexpected body`);
  }
  return answer;
}

/**
 * Tokenizes a test card with the public key, as Frames would, and stores it
 * as an instrument with the secret key. Only the public key may call
 * `/tokens`, which is why a live run needs `CKO_PUBLIC_KEY` for its charge
 * tests.
 */
export async function MintInstrument(
  target: Target,
  cardNumber: string,
  customer?: string,
): Promise<string> {
  if (!target.publicKey) {
    throw new Error("Minting a test instrument needs a public key");
  }
  const { token } = await post(
    target,
    "/tokens",
    target.publicKey,
    testCard(cardNumber),
    isTokenResponse,
  );
  const instrument: InstrumentRequest = { type: "token", token };
  if (customer) instrument.customer = { id: customer };
  const { id } = await post(
    target,
    "/instruments",
    target.secretKey,
    instrument,
    isInstrumentResponse,
  );
  return id;
}

/** A single-use token for a test card, as a payer's browser would get one. */
export async function MintToken(
  target: Target,
  cardNumber: string,
): Promise<string> {
  if (!target.publicKey) {
    throw new Error("Minting a test token needs a public key");
  }
  const { token } = await post(
    target,
    "/tokens",
    target.publicKey,
    testCard(cardNumber),
    isTokenResponse,
  );
  return token;
}
