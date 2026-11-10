import { NextRequest } from "next/server";
import { decodeCursor, parseLimit } from "@/lib/coletivo/cursor";
import { err, json, requireColetivoApp, storeErrorResponse } from "@/lib/coletivo/http";
import { listFeed } from "@/lib/coletivo/store";
import { feedView, nextCursor } from "@/lib/coletivo/views";

export const runtime = "nodejs";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

// Public feed of published Coletivo posts, from the API's own table (no
// hashtag-based reverse feed). App credential required; no session.
export async function GET(req: NextRequest) {
  const denied = requireColetivoApp(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("context_kind");
  const slug = sp.get("context_slug");
  if (!!kind !== !!slug || (kind && kind !== "instalacao" && kind !== "evento") || (slug && !SLUG_RE.test(slug))) {
    return err(400, "invalid_context");
  }
  const cursor = decodeCursor(sp.get("cursor"));
  if (cursor === "invalid") return err(400, "invalid_cursor");
  const limit = parseLimit(sp.get("limit"));
  try {
    const items = await listFeed({ kind: kind || null, slug: slug || null }, { before: cursor?.ts ?? null, beforeId: cursor?.id ?? null, limit });
    return json(200, { success: true, items: items.map(feedView), next_cursor: nextCursor(items, limit, (r) => r.published_at) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
