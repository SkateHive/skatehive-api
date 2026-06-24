import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastCustomJson } from "@/lib/userbase/posting";

export const runtime = "nodejs";

// Follow/mute on behalf of a userbase user (server signs with their own stored
// key). Disallowed for lite accounts on the shared @skateuser account.
export async function POST(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const following = String(body?.following || "");
  const type = body?.type === undefined ? "blog" : String(body.type);
  if (!following || !["blog", "ignore", "blacklist", ""].includes(type)) {
    return NextResponse.json(
      { success: false, error: "following and a valid type are required" },
      { status: 400 }
    );
  }

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/follow] signer", e);
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

  const json = JSON.stringify(["follow", { follower: signer.author, following, what: [type] }]);

  try {
    await broadcastCustomJson(signer, "follow", json);
  } catch (e) {
    console.error("[userbase/hive/follow] broadcast", e);
    return NextResponse.json({ success: false, error: "Follow failed to broadcast" }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
