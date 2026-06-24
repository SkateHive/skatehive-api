import { HiveClient } from "@/app/utils/hive/hiveUtils";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Ported from the web app's lib/utils/hiveAccountUtils.ts so mobile signups
// pick a Hive-valid, on-chain-available username (claimable later via sponsorship).

export function validateHiveUsernameFormat(username: string): {
  isValid: boolean;
  error?: string;
} {
  const u = (username || "").trim().toLowerCase();
  if (u.length < 3 || u.length > 16)
    return { isValid: false, error: "Must be 3–16 characters" };
  if (!/^[a-z]/.test(u))
    return { isValid: false, error: "Must start with a letter" };
  if (!/[a-z0-9]$/.test(u))
    return { isValid: false, error: "Must end with a letter or number" };
  if (!/^[a-z0-9.-]+$/.test(u))
    return { isValid: false, error: "Only lowercase letters, numbers, '.' and '-'" };
  if (/[.-]{2,}/.test(u))
    return { isValid: false, error: "No adjacent '.' or '-'" };
  for (const seg of u.split(".")) {
    if (seg.length < 3)
      return { isValid: false, error: "Each segment must be at least 3 characters" };
  }
  return { isValid: true };
}

/** True if the account already exists on Hive (i.e. NOT available to claim). */
export async function checkHiveAccountExists(username: string): Promise<boolean> {
  const u = (username || "").trim().toLowerCase();
  if (u.length < 3 || u.length > 16) return false;
  if (!/^[a-z][a-z0-9.-]*[a-z0-9]$/.test(u)) return false;
  const accounts = await HiveClient.database.getAccounts([u]);
  return accounts.length > 0;
}

/**
 * True if the handle is already reserved by another userbase account in our DB.
 * Mirrors the web app's /auth/lookup, which checks DB uniqueness AND on-chain
 * existence so the picker can't show "available" for a name that signup will
 * then reject. Throws on a DB error so callers can fail safe (treat as taken).
 */
export async function isHandleReservedInUserbase(handle: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const u = (handle || "").trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("userbase_users")
    .select("id")
    .eq("handle", u)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.[0]);
}
