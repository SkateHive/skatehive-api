import crypto from "crypto";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Server-side email OTP. The code is stored hashed (bound to the email) with a
// short TTL + attempt cap, so it can't be brute-forced offline (we never return
// anything code-derived to the client). Requires the `userbase_email_otps`
// table — canonical schema lives with the rest of userbase in
// apps/skatehive3.0/sql/migrations/0024_userbase_email_otps.sql.

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(email: string, code: string): string {
  return crypto
    .createHash("sha256")
    .update(`${email.toLowerCase()}:${code}`)
    .digest("hex");
}

/** Create + store an OTP, returning the plaintext code to email to the user. */
export async function createOtp(email: string): Promise<string> {
  if (!supabaseAdmin) throw new Error("Userbase backend not configured");
  const code = generateOtpCode();
  const expiresAt = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000
  ).toISOString();
  const { error } = await supabaseAdmin.from("userbase_email_otps").insert({
    email: email.toLowerCase(),
    code_hash: hashCode(email, code),
    attempts: 0,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`OTP insert failed: ${error.message}`);
  return code;
}

/** Verify + single-use-consume the newest live OTP for an email. */
export async function verifyOtp(email: string, code: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const em = email.toLowerCase();
  const { data } = await supabaseAdmin
    .from("userbase_email_otps")
    .select("id, code_hash, attempts, expires_at, consumed_at")
    .eq("email", em)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  if (row.attempts >= MAX_ATTEMPTS) return false;

  if (row.code_hash !== hashCode(em, code)) {
    await supabaseAdmin
      .from("userbase_email_otps")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return false;
  }

  // Atomic single-use consume.
  const { data: consumed } = await supabaseAdmin
    .from("userbase_email_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  return !!(consumed && consumed.length);
}
