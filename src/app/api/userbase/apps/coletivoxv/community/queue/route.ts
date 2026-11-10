import { NextRequest } from "next/server";
import { decodeCursor, parseLimit } from "@/lib/coletivo/cursor";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { listQueue } from "@/lib/coletivo/store";
import { nextCursor, queueView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

const STATUSES = new Set(["pending", "approved", "publishing", "failed", "published", "rejected"]);

// Moderator queue (DB enforces the binding).
export async function GET(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "pending";
  if (!STATUSES.has(status)) return err(400, "invalid_status");
  const cursor = decodeCursor(sp.get("cursor"));
  if (cursor === "invalid") return err(400, "invalid_cursor");
  const limit = parseLimit(sp.get("limit"));
  try {
    const items = await listQueue(s.tokenHash, status, { before: cursor?.ts ?? null, beforeId: cursor?.id ?? null, limit });
    return json(200, { success: true, items: items.map(queueView), next_cursor: nextCursor(items, limit, (r) => r.created_at) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
