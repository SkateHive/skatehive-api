import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastComment, recordSoftPost } from "@/lib/userbase/posting";
import { getSafeUserIdentifier } from "@/lib/userbase/safeUser";

export const runtime = "nodejs";

function genPermlink(): string {
  return `re-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Comment/reply (and snaps) on behalf of a userbase user. Server signs with the
// user's stored key, or the shared @skateuser account for lite accounts —
// recording attribution + embedding the safe-user id for the feed overlay.
export async function POST(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parentAuthor = String(body?.parent_author || "");
  const parentPermlink = String(body?.parent_permlink || "");
  const content = String(body?.body || "").trim();
  if (!parentPermlink || !content) {
    return NextResponse.json(
      { success: false, error: "parent_permlink and body are required" },
      { status: 400 }
    );
  }
  const permlink = String(body?.permlink || "") || genPermlink();
  const title = body?.title ? String(body.title) : "";

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/comment] signer", e);
    return NextResponse.json({ success: false, error: "Posting not available" }, { status: 500 });
  }

  const incoming =
    body?.json_metadata && typeof body.json_metadata === "object"
      ? (body.json_metadata as Record<string, unknown>)
      : {};
  const metadata: Record<string, unknown> = {
    ...incoming,
    app: typeof incoming.app === "string" ? incoming.app : "skatehive-mobile",
  };
  const safe = getSafeUserIdentifier(userId);
  if (safe) metadata.skatehive_user = safe;

  // Beneficiaries (reward split) — mirror the web route's validation rules so a
  // proxied web comment keeps its comment_options instead of dropping them.
  const rawBenef = Array.isArray(body?.beneficiaries) ? body.beneficiaries : [];
  let beneficiaries: Array<{ account: string; weight: number }> = [];
  if (rawBenef.length > 0) {
    const total = rawBenef.reduce((s: number, b: any) => s + Number(b?.weight || 0), 0);
    if (total > 10000) {
      return NextResponse.json({ success: false, error: "Beneficiaries exceed 100%" }, { status: 400 });
    }
    beneficiaries = rawBenef
      .filter(
        (b: any) =>
          b?.account &&
          typeof b.account === "string" &&
          /^[a-z][a-z0-9.-]{2,15}$/.test(b.account) &&
          Number(b?.weight) > 0
      )
      .map((b: any) => ({ account: b.account, weight: Number(b.weight) }));
  }

  try {
    await broadcastComment(signer, {
      parentAuthor,
      parentPermlink,
      permlink,
      title,
      body: content,
      jsonMetadata: metadata,
      beneficiaries,
    });
  } catch (e) {
    console.error("[userbase/hive/comment] broadcast", e);
    return NextResponse.json({ success: false, error: "Comment failed to broadcast" }, { status: 502 });
  }

  if (signer.usingDefault) {
    await recordSoftPost(userId, {
      author: signer.author,
      permlink,
      title,
      type: parentAuthor ? "comment" : "post",
      metadata: {
        onchain: metadata,
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        title,
        body: content,
        safe_user: safe,
        beneficiaries: beneficiaries.length > 0 ? beneficiaries : undefined,
      },
    }).catch((e) => console.error("[userbase/hive/comment] soft-post", e));
  }

  return NextResponse.json({ success: true, author: signer.author, permlink });
}
