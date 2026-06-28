import { NextRequest, NextResponse } from "next/server";
import { resolveUserbaseUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastVote, recordSoftVote } from "@/lib/userbase/posting";
import { getSafeUserIdentifier } from "@/lib/userbase/safeUser";

export const runtime = "nodejs";

// Vote on behalf of a userbase user (server signs with their stored key, or the
// shared @skateuser account for lite accounts).
export async function POST(req: NextRequest) {
  const userId = await resolveUserbaseUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const author = String(body?.author || "");
  const permlink = String(body?.permlink || "");
  let weight = Number(body?.weight);
  if (!author || !permlink || !Number.isFinite(weight)) {
    return NextResponse.json(
      { success: false, error: "author, permlink and weight are required" },
      { status: 400 }
    );
  }
  weight = Math.max(-10000, Math.min(10000, Math.round(weight)));

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/vote] signer", e);
    return NextResponse.json({ success: false, error: "Posting not available" }, { status: 500 });
  }

  try {
    await broadcastVote(signer, author, permlink, weight);
  } catch (e) {
    console.error("[userbase/hive/vote] broadcast", e);
    return NextResponse.json({ success: false, error: "Vote failed to broadcast" }, { status: 502 });
  }

  if (signer.usingDefault) {
    await recordSoftVote(userId, {
      author,
      permlink,
      weight,
      metadata: { safe_user: getSafeUserIdentifier(userId) },
    }).catch((e) => console.error("[userbase/hive/vote] soft-vote", e));
  }

  return NextResponse.json({ success: true });
}
