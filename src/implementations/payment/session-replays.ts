import type { CheckoutSession } from "@antelopejs/interface-payment";

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 10_000;

interface Remembered {
  session: Promise<CheckoutSession>;
  until: number;
}

const sessions = new Map<string, Remembered>();

function keyOf(provider: string | undefined, idempotencyKey: string): string {
  return JSON.stringify([provider ?? "", idempotencyKey]);
}

function forgetExpired(now: number): void {
  for (const [key, remembered] of sessions) {
    if (remembered.until > now && sessions.size <= MAX_REMEMBERED) return;
    sessions.delete(key);
  }
}

/**
 * Creates the session for a key once per process, for as long as a hosted
 * page lives. Concurrent calls with the same key share the one creation; a
 * creation that fails is forgotten, so the key can be retried.
 */
export function SessionOnce(
  provider: string | undefined,
  idempotencyKey: string,
  create: () => Promise<CheckoutSession>,
): Promise<CheckoutSession> {
  const now = Date.now();
  const key = keyOf(provider, idempotencyKey);
  const remembered = sessions.get(key);
  if (remembered && remembered.until > now) return remembered.session;
  const session = create();
  sessions.set(key, { session, until: now + SESSION_LIFETIME_MS });
  forgetExpired(now);
  session.catch(() => sessions.delete(key));
  return session;
}
