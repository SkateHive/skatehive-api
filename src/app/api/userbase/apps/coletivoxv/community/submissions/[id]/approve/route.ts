import { NextRequest, after } from "next/server";
import { err, isUuid, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { runPublishFlow } from "@/lib/coletivo/service";
import { reviewPost } from "@/lib/coletivo/store";
import { submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

// Moderator approves (DB checks the binding). Publishing starts right after the
// response; the UI polls GET submissions/:id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_found");
  try {
    const row = await reviewPost(s.tokenHash, id, "approve");
    after(() => runPublishFlow(row.id).then(() => undefined));
    return json(200, { success: true, submission: submissionView(row) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
