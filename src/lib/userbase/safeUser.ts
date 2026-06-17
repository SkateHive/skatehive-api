import crypto from "crypto";

// Privacy-preserving per-user id embedded in posts so the feed can overlay the
// real author over the shared @skateuser account. Ported verbatim from the web
// app — the secret precedence MUST match so the ids line up across services.
export function getSafeUserIdentifier(userId: string): string | null {
  const secret =
    process.env.USERBASE_INTERNAL_TOKEN || process.env.USERBASE_KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
}
