import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { resolveUserbaseUserId } from "@/lib/userbase/session";
import { isRateLimited, recordAttempt } from "@/lib/userbase/rateLimit";
import { codeHash, generateLinkCode, LINK_CODE_TTL_MS } from "@/lib/whatsapp/core";

export const runtime = "nodejs";

// A logged-in user asks for a short-lived code to link their WhatsApp. They
// then send the code to the bot from that WhatsApp; /link/confirm binds it.
export async function POST(req: NextRequest) {
  const userId = await resolveUserbaseUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ success: false, error: "unavailable" }, { status: 503 });

  const key = `wa:code:${userId}`;
  if (isRateLimited(key, 5, 10 * 60_000)) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429 });
  }
  recordAttempt(key, 10 * 60_000);

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from("userbase_whatsapp_link_codes").insert({
    code_hash: codeHash(code),
    user_id: userId,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[whatsapp/link/code]", error.message);
    return NextResponse.json({ success: false, error: "unavailable" }, { status: 503 });
  }
  return NextResponse.json({ success: true, code, expires_at: expiresAt, bot_number: process.env.WHATSAPP_BOT_NUMBER || null });
}
