import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { botCall, fail } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

// Bot only. Body: { sender }. The person asked to unlink this number.
export async function POST(req: NextRequest) {
  const call = await botCall(req, "unlink", 5, 10 * 60_000);
  if (!call.ok) return call.res;
  const { error } = await supabaseAdmin!.from("userbase_whatsapp_links").delete().eq("phone_hash", call.phoneHash);
  if (error) return fail(503, "unavailable");
  return NextResponse.json({ success: true });
}
