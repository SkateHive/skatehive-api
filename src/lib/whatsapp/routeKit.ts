import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { isRateLimited, recordAttempt } from "@/lib/userbase/rateLimit";
import { isWhatsappBot, normalizePhone, phoneHash } from "./core";

export function fail(status: number, code: string) {
  return NextResponse.json({ success: false, error: code }, { status });
}

export type BotCall =
  | { ok: true; body: any; phoneHash: string }
  | { ok: false; res: NextResponse };

/**
 * Gate for every bot route: the caller must be the whatsapp app, the body must
 * carry the sender's number (from the gateway), and the backend must be set up.
 * Rate limited per phone hash.
 */
export async function botCall(req: Request, bucket: string, limit = 30, windowMs = 60_000): Promise<BotCall> {
  if (!isWhatsappBot(req.headers)) return { ok: false, res: fail(401, "unauthorized") };
  if (!supabaseAdmin) return { ok: false, res: fail(503, "unavailable") };
  const body = await req.json().catch(() => null);
  const digits = normalizePhone(body?.sender);
  if (!digits) return { ok: false, res: fail(422, "invalid_sender") };
  let hash: string;
  try {
    hash = phoneHash(digits);
  } catch {
    return { ok: false, res: fail(503, "unavailable") };
  }
  const key = `wa:${bucket}:${hash}`;
  if (isRateLimited(key, limit, windowMs)) return { ok: false, res: fail(429, "rate_limited") };
  recordAttempt(key, windowMs);
  return { ok: true, body, phoneHash: hash };
}

/** user_id linked to this phone hash, or null. Throws on DB errors (fail closed). */
export async function linkedUserId(hash: string): Promise<string | null> {
  if (!supabaseAdmin) throw new Error("unavailable");
  const { data, error } = await supabaseAdmin
    .from("userbase_whatsapp_links")
    .select("user_id")
    .eq("phone_hash", hash)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.user_id as string | undefined) ?? null;
}
