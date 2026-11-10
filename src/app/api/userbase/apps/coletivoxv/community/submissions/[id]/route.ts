import { NextRequest } from "next/server";
import { err, isUuid, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { getPost } from "@/lib/coletivo/store";
import { submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

// Owner or moderator only (enforced in the DB). Used by the UI to poll status.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_found");
  try {
    return json(200, { success: true, submission: submissionView(await getPost(s.tokenHash, id)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
