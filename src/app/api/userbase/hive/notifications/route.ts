import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastCustomJson } from "@/lib/userbase/posting";

export const runtime = "nodejs";

// Mark a userbase user's Hive notifications as read (notify/setLastRead) on
// their behalf. Requires the user's own Hive account — the shared @skateuser
// account's notifications must never be touched, and lite accounts have none.
export async function POST(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date().toISOString();

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/notifications] signer", e);
    return NextResponse.json({ success: false, error: "Posting not available" }, { status: 500 });
  }

  if (signer.usingDefault) {
    return NextResponse.json(
      {
        success: false,
        error: "This action requires your own Hive account",
        code: "REQUIRES_OWN_HIVE_ACCOUNT",
      },
      { status: 403 }
    );
  }

  const json = JSON.stringify(["setLastRead", { date: now }]);

  try {
    await broadcastCustomJson(signer, "notify", json);
  } catch (e) {
    console.error("[userbase/hive/notifications] broadcast", e);
    return NextResponse.json(
      { success: false, error: "Mark-read failed to broadcast" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
