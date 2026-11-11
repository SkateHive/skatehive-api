import { NextRequest, NextResponse } from "next/server";
import { err, isUuid, requireColetivoApp, storeErrorResponse } from "@/lib/coletivo/http";
import { decodeCommentCursor, readComments, type ChainReader } from "@/lib/coletivo/engagement";
import { chainReader, commentsCache, publishedTargets } from "@/lib/coletivo/engagementService";

export const runtime = "nodejs";

// First-level replies of a PUBLISHED Coletivo post, read on demand from its own
// author/permlink (never the snaps container). App credential only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireColetivoApp(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_published");
  const sp = req.nextUrl.searchParams;
  const cursor = decodeCommentCursor(sp.get("cursor"));
  if (cursor === "invalid") return err(400, "invalid_cursor");
  const n = Number.parseInt(sp.get("limit") || "", 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;

  let target;
  try {
    target = (await publishedTargets([id.toLowerCase()])).get(id.toLowerCase());
  } catch (e) {
    return storeErrorResponse(e);
  }
  // Unknown and unpublished look the same, and no destination leaks.
  if (!target) return err(404, "not_published");

  const key = `${target.publish_author}/${target.publish_permlink}`;
  const hit = commentsCache.get(key);
  let fetched: { raw: unknown; replies: unknown } | null = null;
  const reader: ChainReader = hit
    ? { getContent: async () => hit.raw, getReplies: async () => hit.replies }
    : {
        getContent: async (a, p, s) => ((fetched ??= { raw: undefined, replies: undefined }).raw = await chainReader.getContent(a, p, s)),
        getReplies: async (a, p, s) => ((fetched ??= { raw: undefined, replies: undefined }).replies = await chainReader.getReplies(a, p, s)),
      };
  // One budget for the whole read: the fetches are aborted when it runs out.
  const page = await readComments(target, reader, { timeoutMs: 6000, limit, cursor, signal: AbortSignal.timeout(6500) });
  if (page.status !== "ok") return err(503, page.code === "chain_mismatch" ? "chain_mismatch" : "chain_unavailable");
  if (!hit && fetched) commentsCache.set(key, fetched);
  const { status: _s, ...body } = page;
  return NextResponse.json({ success: true, ...body }, { status: 200, headers: { "Cache-Control": "private, max-age=15" } });
}
