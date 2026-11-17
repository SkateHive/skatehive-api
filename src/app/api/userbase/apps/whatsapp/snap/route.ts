import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { broadcastComment, recordSoftPost, resolveSigner } from "@/lib/userbase/posting";
import { getSafeUserIdentifier } from "@/lib/userbase/safeUser";
import { permalinkUrl, resolveSnapContainer } from "@/lib/coletivo/service";
import { cleanSnapBody, SNAPS_PER_DAY, snapMetadata, snapPermlink, utcDayStart } from "@/lib/whatsapp/core";
import { botCall, fail, linkedUserId } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

// Bot only. Body: { sender, body }. Publishes a text snap as the user linked to
// the sender's number: their own key, or the shared account with soft-post
// attribution. The bot must have shown a preview and got the person's "sim".
export async function POST(req: NextRequest) {
  const call = await botCall(req, "snap", 3, 60_000);
  if (!call.ok) return call.res;
  const text = cleanSnapBody(call.body?.body);
  if (!text) return fail(422, "invalid_body");

  let userId: string | null;
  try {
    userId = await linkedUserId(call.phoneHash);
  } catch {
    return fail(503, "unavailable");
  }
  if (!userId) return fail(403, "not_linked");

  const { count, error: countError } = await supabaseAdmin!
    .from("userbase_whatsapp_posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", utcDayStart());
  if (countError) return fail(503, "unavailable");
  if ((count ?? 0) >= SNAPS_PER_DAY) return fail(429, "daily_limit");

  let signer;
  let target;
  try {
    signer = await resolveSigner(userId);
    target = await resolveSnapContainer();
  } catch (e) {
    console.error("[whatsapp/snap] setup", e);
    return fail(503, "posting_unavailable");
  }

  const permlink = snapPermlink();
  const safe = getSafeUserIdentifier(userId);
  const metadata = snapMetadata(safe);
  try {
    await broadcastComment(signer, {
      parentAuthor: target.parentAuthor,
      parentPermlink: target.parentPermlink,
      permlink,
      title: "",
      body: text,
      jsonMetadata: metadata,
    });
  } catch (e) {
    console.error("[whatsapp/snap] broadcast", e);
    return fail(502, "broadcast_failed");
  }

  // After a successful broadcast nothing below may fail the request: the snap
  // is on chain. Log and move on.
  const { error: logError } = await supabaseAdmin!
    .from("userbase_whatsapp_posts")
    .insert({ user_id: userId, author: signer.author, permlink });
  if (logError) console.error("[whatsapp/snap] log", logError.message);
  if (signer.usingDefault) {
    await recordSoftPost(userId, {
      author: signer.author,
      permlink,
      title: "",
      type: "snap",
      metadata: {
        onchain: metadata,
        parent_author: target.parentAuthor,
        parent_permlink: target.parentPermlink,
        body: text,
        safe_user: safe,
      },
    }).catch((e) => console.error("[whatsapp/snap] soft-post", e));
  }

  return NextResponse.json({
    success: true,
    author: signer.author,
    permlink,
    url: permalinkUrl(signer.author, permlink),
  });
}
