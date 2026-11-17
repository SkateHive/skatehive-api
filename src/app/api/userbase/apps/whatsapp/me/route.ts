import { NextRequest, NextResponse } from "next/server";
import { getUserPublic } from "@/lib/userbase/session";
import { resolveSigner } from "@/lib/userbase/posting";
import { botCall, fail, linkedUserId } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

// Bot only. Body: { sender }. Who is this WhatsApp number on Skatehive?
export async function POST(req: NextRequest) {
  const call = await botCall(req, "me");
  if (!call.ok) return call.res;
  let userId: string | null;
  try {
    userId = await linkedUserId(call.phoneHash);
  } catch {
    return fail(503, "unavailable");
  }
  if (!userId) return NextResponse.json({ success: true, linked: false });
  const user = await getUserPublic(userId);
  let posting: "own_account" | "shared_account" | "unavailable" = "unavailable";
  try {
    posting = (await resolveSigner(userId)).usingDefault ? "shared_account" : "own_account";
  } catch {
    /* posting stays unavailable */
  }
  return NextResponse.json({
    success: true,
    linked: true,
    user: user ? { handle: user.handle, display_name: user.display_name } : null,
    posting,
  });
}
