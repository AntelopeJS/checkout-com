const SANDBOX_KEY_PREFIX = "sk_sbox_";
const PROCESSING_CHANNEL = /^pc_\w{26}$/;

export interface LiveEnvironment {
  mode: "live";
  secretKey: string;
  processingChannelId: string;
  baseUrl?: string;
}

interface StandInEnvironment {
  mode: "stand-in";
}

export type TestEnvironment = LiveEnvironment | StandInEnvironment;

function assertSandbox(secretKey: string): void {
  if (!secretKey.startsWith(SANDBOX_KEY_PREFIX)) {
    throw new Error(
      `CKO_SECRET_KEY is not a sandbox key (${SANDBOX_KEY_PREFIX}…); refusing to run the suite against production`,
    );
  }
}

function assertChannel(processingChannelId: string): void {
  if (!PROCESSING_CHANNEL.test(processingChannelId)) {
    throw new Error(
      "CKO_PROCESSING_CHANNEL_ID is not a processing channel id (pc_ followed by 26 characters)",
    );
  }
}

/**
 * Decides whether the suite runs against Checkout.com's sandbox or the
 * stand-in. A key and a processing channel together mean live; neither means
 * the stand-in; one without the other is a mistake that would otherwise run
 * the stand-in while the person believed they were testing live, so it throws.
 */
export function ResolveEnvironment(
  env: Record<string, string | undefined>,
): TestEnvironment {
  const secretKey = env.CKO_SECRET_KEY || undefined;
  const processingChannelId = env.CKO_PROCESSING_CHANNEL_ID || undefined;
  if (!secretKey && !processingChannelId) {
    return { mode: "stand-in" };
  }
  if (!secretKey || !processingChannelId) {
    throw new Error(
      "Set both CKO_SECRET_KEY and CKO_PROCESSING_CHANNEL_ID to run live, or neither to run against the stand-in",
    );
  }
  assertSandbox(secretKey);
  assertChannel(processingChannelId);
  return {
    mode: "live",
    secretKey,
    processingChannelId,
    ...(env.CKO_BASE_URL ? { baseUrl: env.CKO_BASE_URL } : {}),
  };
}
