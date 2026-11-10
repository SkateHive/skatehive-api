import { NextRequest } from "next/server";
import { err, isUuid, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { reviewPost } from "@/lib/coletivo/store";
import { parseRejectReason } from "@/lib/coletivo/validation";
import { submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const { id } = await params;
  if (!isUuid(id)) return err(404, "not_found");
  const reason = parseRejectReason((await req.json().catch(() => null))?.reason);
  if (!reason.ok) return err(400, reason.code, reason.error);
  try {
    return json(200, { success: true, submission: submissionView(await reviewPost(s.tokenHash, id, "reject", reason.value)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
