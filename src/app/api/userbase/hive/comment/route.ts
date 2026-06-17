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

  const metadata: Record<string, unknown> = {
    ...(body?.json_metadata && typeof body.json_metadata === "object" ? body.json_metadata : {}),
    app: "skatehive-mobile",
  };
  const safe = getSafeUserIdentifier(userId);
  if (safe) metadata.skatehive_user = safe;

  try {
    await broadcastComment(signer, {
      parentAuthor,
      parentPermlink,
      permlink,
      title,
      body: content,
      jsonMetadata: metadata,
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
      },
    }).catch((e) => console.error("[userbase/hive/comment] soft-post", e));
  }

  return NextResponse.json({ success: true, author: signer.author, permlink });
}
