import { constantTimeEqual } from "@/lib/security";

export const RESEARCH_SESSION_COOKIE_NAME = "policy_research_session";
export const RESEARCH_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const RESEARCH_ACCESS_PASSWORD_MIN_LENGTH = 12;
export const RESEARCH_SESSION_SECRET_MIN_LENGTH = 32;

type ResearchAuthConfig = {
  accessPassword: string;
  sessionSecret: string;
};

const textEncoder = new TextEncoder();

export function getResearchAuthConfig(): ResearchAuthConfig | null {
  const accessPassword = process.env.POLICY_RESEARCH_ACCESS_PASSWORD;
  const sessionSecret = process.env.POLICY_RESEARCH_SESSION_SECRET;

  if (
    !accessPassword ||
    accessPassword.length < RESEARCH_ACCESS_PASSWORD_MIN_LENGTH ||
    !sessionSecret ||
    sessionSecret.length < RESEARCH_SESSION_SECRET_MIN_LENGTH
  ) {
    return null;
  }
  return { accessPassword, sessionSecret };
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function credentialVersion(config: ResearchAuthConfig): Promise<string> {
  const digest = await hmacHex(`research-password:${config.accessPassword}`, config.sessionSecret);
  return digest.slice(0, 16);
}

export async function verifyResearchPassword(
  candidate: string,
  config: ResearchAuthConfig
): Promise<boolean> {
  const [candidateDigest, expectedDigest] = await Promise.all([
    hmacHex(`research-password:${candidate}`, config.sessionSecret),
    hmacHex(`research-password:${config.accessPassword}`, config.sessionSecret),
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

export async function createResearchSessionToken(
  config: ResearchAuthConfig,
  now = Date.now()
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAtSeconds = Math.floor(now / 1000) + RESEARCH_SESSION_TTL_SECONDS;
  const version = await credentialVersion(config);
  const payload = `v1.${expiresAtSeconds}.${version}`;
  const signature = await hmacHex(`research-session:${payload}`, config.sessionSecret);

  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export async function verifyResearchSessionToken(
  token: string | undefined,
  config: ResearchAuthConfig,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [format, rawExpiresAt, version, signature] = parts;
  if (format !== "v1" || !/^\d{10}$/.test(rawExpiresAt) || !/^[a-f0-9]{16}$/.test(version)) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;

  const expiresAtSeconds = Number.parseInt(rawExpiresAt, 10);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= nowSeconds ||
    expiresAtSeconds > nowSeconds + RESEARCH_SESSION_TTL_SECONDS
  ) {
    return false;
  }

  const payload = `${format}.${rawExpiresAt}.${version}`;
  const [expectedSignature, expectedVersion] = await Promise.all([
    hmacHex(`research-session:${payload}`, config.sessionSecret),
    credentialVersion(config),
  ]);
  return (
    constantTimeEqual(signature, expectedSignature) &&
    constantTimeEqual(version, expectedVersion)
  );
}
