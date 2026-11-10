import { NextRequest } from "next/server";
import { decodeCursor, parseLimit } from "@/lib/coletivo/cursor";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { listMine } from "@/lib/coletivo/store";
import { nextCursor, submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const sp = req.nextUrl.searchParams;
  const cursor = decodeCursor(sp.get("cursor"));
  if (cursor === "invalid") return err(400, "invalid_cursor");
  const limit = parseLimit(sp.get("limit"));
  try {
    const items = await listMine(s.tokenHash, { before: cursor?.ts ?? null, beforeId: cursor?.id ?? null, limit });
    return json(200, { success: true, items: items.map(submissionView), next_cursor: nextCursor(items, limit, (r) => r.created_at) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
