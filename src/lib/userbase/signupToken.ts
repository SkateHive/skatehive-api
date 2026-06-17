import crypto from "crypto";

// Short-lived HMAC token proving an email was just OTP-verified, so the
// follow-up "choose username + create account" call is authorized without
// re-sending the code. Stateless (no DB row) — payload + HMAC signature.

const TTL_MINUTES = 15;

function secret(): string {
  const s =
    process.env.USERBASE_INTERNAL_TOKEN ||
    process.env.USERBASE_KEY_ENCRYPTION_SECRET;
  if (!s) throw new Error("Signup token secret not configured");
  return s;
}

export function signSignupToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + TTL_MINUTES * 60 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySignupToken(token: string): { email: string } | null {
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!email || typeof exp !== "number" || exp < Date.now()) return null;
    return { email };
  } catch {
    return null;
  }
}
