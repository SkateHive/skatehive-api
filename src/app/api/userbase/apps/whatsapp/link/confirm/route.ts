import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { getUserPublic } from "@/lib/userbase/session";
import { codeHash, normalizeLinkCode } from "@/lib/whatsapp/core";
import { botCall, fail } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

// Bot only. Body: { sender, code }. Binds the sender's phone to the code's user.
export async function POST(req: NextRequest) {
  const call = await botCall(req, "confirm", 5, 10 * 60_000);
  if (!call.ok) return call.res;
  const code = normalizeLinkCode(call.body?.code);
  if (!code) return fail(422, "invalid_code");

  const { data, error } = await supabaseAdmin!.rpc("userbase_whatsapp_link_confirm", {
    p_code_hash: codeHash(code),
    p_phone_hash: call.phoneHash,
  });
  if (error) {
    if (error.code === "UB410") return fail(410, "code_expired_or_used");
    console.error("[whatsapp/link/confirm]", error.message);
    return fail(503, "unavailable");
  }
  const user = await getUserPublic(String(data));
  return NextResponse.json({
    success: true,
    user: user ? { handle: user.handle, display_name: user.display_name } : null,
  });
}
