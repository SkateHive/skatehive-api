import { NextRequest } from "next/server";
import { WITHDRAWN_ERROR_CODE } from "@/lib/coletivo/config";
import { err, isUuid, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { runPublishFlow } from "@/lib/coletivo/service";
import { getPost, me, requeuePublish, StoreError } from "@/lib/coletivo/store";
import { submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

// Moderator retry: a failed post is re-queued by the DB (never after
// signer_changed); an approved/stuck one is just picked up again. Publishing is
// idempotent (DB claim + chain reconciliation), so a double click is harmless.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_found");
  try {
    if (!(await me(s.tokenHash)).moderator_handle) return err(403, "forbidden");
    const current = await getPost(s.tokenHash, id);
    // A withdrawn post stays out of the queue for good: refuse BEFORE any
    // requeue or publish attempt, whatever its status.
    if (current.last_error_code === WITHDRAWN_ERROR_CODE) return err(409, "withdrawn");
    if (current.status === "failed") await requeuePublish(s.tokenHash, id);
    else if (current.status !== "approved" && current.status !== "publishing") throw new StoreError(409, "conflict");
    const outcome = await runPublishFlow(id);
    return json(200, { success: true, outcome, submission: submissionView(await getPost(s.tokenHash, id)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
