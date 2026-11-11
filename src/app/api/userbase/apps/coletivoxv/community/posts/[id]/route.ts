import { NextRequest } from "next/server";
import { err, isUuid, json, requireColetivoApp, storeErrorResponse } from "@/lib/coletivo/http";
import { getPublicPost, StoreError } from "@/lib/coletivo/store";
import { feedView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

// Public detail of a PUBLISHED Coletivo post (article page, share/OG).
// App credential only, no session. Anything else -> 404 with no destination.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireColetivoApp(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_published");
  try {
    const row = await getPublicPost(id.toLowerCase());
    return json(200, { success: true, post: feedView(row) });
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) return err(404, "not_published");
    return storeErrorResponse(e);
  }
}
