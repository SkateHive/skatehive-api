import { NextRequest, NextResponse } from "next/server";
import { err, isUuid, requireColetivoApp, storeErrorResponse } from "@/lib/coletivo/http";
import { boundedAll, readEngagement, type Engagement } from "@/lib/coletivo/engagement";
import { chainReader, engagementCache, publishedTargets } from "@/lib/coletivo/engagementService";

export const runtime = "nodejs";

const MAX_IDS = 24;

// Read-only counts for PUBLISHED Coletivo posts (positive votes, total
// replies). App credential only; public data. Unknown/unpublished ids are
// absent; a chain failure is listed in `unavailable`, never reported as 0.
export async function GET(req: NextRequest) {
  const denied = requireColetivoApp(req);
  if (denied) return denied;
  const raw = (req.nextUrl.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = [...new Set(raw.map((s) => s.toLowerCase()))];
  if (!ids.length || ids.length > MAX_IDS || !ids.every(isUuid)) return err(400, "invalid_ids");

  let targets;
  try {
    targets = await publishedTargets(ids);
  } catch (e) {
    return storeErrorResponse(e);
  }

  const list = [...targets.values()];
  const { results } = await boundedAll<typeof list[number], [string, Engagement]>(
    list,
    async (t, signal) => {
      const key = `${t.publish_author}/${t.publish_permlink}`;
      const hit = engagementCache.get(key);
      if (hit) return [t.id, hit];
      // The batch deadline's signal cancels the in-flight fetch too.
      const e = await readEngagement(t, chainReader, { timeoutMs: 5000, signal });
      if (e.status === "ok") engagementCache.set(key, e);
      return [t.id, e];
    },
    { concurrency: 4, deadlineMs: 8000, onTimeout: (t) => [t.id, { status: "unavailable", code: "timeout" } as Engagement] }
  );

  const items: Record<string, { votes_up: number; comments_total: number; updated_at: string }> = {};
  const unavailable: string[] = [];
  for (const [id, e] of results) {
    if (e.status === "ok") items[id] = { votes_up: e.votes_up, comments_total: e.comments_total, updated_at: e.updated_at };
    else unavailable.push(id);
  }
  if (list.length > 0 && unavailable.length === list.length) return err(503, "chain_unavailable");
  return NextResponse.json(
    { success: true, items, unavailable },
    { status: 200, headers: { "Cache-Control": "private, max-age=15" } }
  );
}
