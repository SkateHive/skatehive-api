import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastCustomJson } from "@/lib/userbase/posting";

export const runtime = "nodejs";

// Broadcast a skatehive_reports custom_json on behalf of a userbase user. The
// report payload is encrypted on the CLIENT for a moderator public key, so this
// endpoint performs no encryption — it just receives the already-built
// custom_json content and broadcasts it under the user's posting authority.
export async function POST(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const payload = body?.payload;
  if (!payload || (typeof payload !== "object" && typeof payload !== "string")) {
    return NextResponse.json({ success: false, error: "payload is required" }, { status: 400 });
  }
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/report] signer", e);
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

  try {
    await broadcastCustomJson(signer, "skatehive_reports", json);
  } catch (e) {
    console.error("[userbase/hive/report] broadcast", e);
    return NextResponse.json({ success: false, error: "Report failed to broadcast" }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
