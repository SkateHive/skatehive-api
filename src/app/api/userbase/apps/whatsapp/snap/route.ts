import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { broadcastComment, recordSoftPost, resolveSigner } from "@/lib/userbase/posting";
import { getSafeUserIdentifier } from "@/lib/userbase/safeUser";
import { getChainPost, permalinkUrl, resolveSnapContainer } from "@/lib/coletivo/service";
import { cleanSnapBody, SNAPS_PER_DAY, snapMetadata, snapPermlink } from "@/lib/whatsapp/core";
import { runSnapFlow, type ReserveResult } from "@/lib/whatsapp/snapFlow";
import { botCall, fail, linkedUserId } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

// Bot only. Body: { sender, body }. Publishes a text snap as the user linked to
// the sender's number: their own key, or the shared account with soft-post
// attribution. The bot must have shown a preview and got the person's "sim".
// The daily cap is an atomic DB reservation taken BEFORE the broadcast
// (migration 0044); see lib/whatsapp/snapFlow.ts for the settle rules.
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

  let signer;
  let target;
  try {
    signer = await resolveSigner(userId);
    target = await resolveSnapContainer();
  } catch (e) {
    console.error("[whatsapp/snap] setup", e);
    return fail(503, "posting_unavailable");
  }

  const uid = userId;
  const permlink = snapPermlink();
  const safe = getSafeUserIdentifier(uid);
  const metadata = snapMetadata(safe);
  const db = supabaseAdmin!;

  const result = await runSnapFlow({
    reserve: async (): Promise<ReserveResult> => {
      const { data, error } = await db.rpc("userbase_whatsapp_snap_reserve", {
        p_user_id: uid,
        p_author: signer.author,
        p_permlink: permlink,
        p_limit: SNAPS_PER_DAY,
      });
      if (error) return { ok: false, reason: error.code === "UB429" ? "daily_limit" : "unavailable" };
      return { ok: true, id: Number(data) };
    },
    broadcast: () =>
      broadcastComment(signer, {
        parentAuthor: target.parentAuthor,
        parentPermlink: target.parentPermlink,
        permlink,
        title: "",
        body: text,
        jsonMetadata: metadata,
      }),
    onChain: async () => ((await getChainPost(signer.author, permlink)) ? true : false),
    settle: async (id, status) => {
      const { error } = await db.rpc("userbase_whatsapp_snap_settle", { p_id: id, p_status: status });
      if (error) throw new Error(error.message);
    },
    afterPublish: async () => {
      if (!signer.usingDefault) return;
      await recordSoftPost(uid, {
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
      });
    },
    log: (msg, e) => console.error(`[whatsapp/snap] ${msg}`, e),
  });

  if (!result.ok) return fail(result.status, result.code);
  return NextResponse.json({
    success: true,
    author: signer.author,
    permlink,
    url: permalinkUrl(signer.author, permlink),
  });
}
