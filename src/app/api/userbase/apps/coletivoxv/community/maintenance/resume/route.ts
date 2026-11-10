import { NextRequest } from "next/server";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { resumeColetivo } from "@/lib/coletivo/service";
import { me } from "@/lib/coletivo/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Moderator recovery button: resumes approved/stale publishes (never requeues
// failed ones) and drains due follow-ups, including for already-published
// posts. Bounded: at most 5 publishes and ~20s.
export async function POST(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  try {
    if (!(await me(s.tokenHash)).moderator_handle) return err(403, "forbidden");
    return json(200, { success: true, report: await resumeColetivo({ maxPublishes: 5, deadlineMs: 20000 }) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
