import { NextRequest } from "next/server";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { isAllowedModeratorHandle } from "@/lib/coletivo/moderatorBinding";
import { createChallenge } from "@/lib/coletivo/store";

export const runtime = "nodejs";

// Step 1 of moderator binding: a fresh, single-use challenge stored in the DB
// and bound to this app session's user AND email.
export async function POST(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const body = await req.json().catch(() => null);
  const handle = typeof body?.hive_handle === "string" ? body.hive_handle.trim().toLowerCase() : "";
  if (!isAllowedModeratorHandle(handle)) return err(403, "not_allowed");
  try {
    const c = await createChallenge(s.tokenHash, handle);
    return json(200, { success: true, challenge_id: c.challenge_id, message: c.message, expires_at: c.expires_at });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
