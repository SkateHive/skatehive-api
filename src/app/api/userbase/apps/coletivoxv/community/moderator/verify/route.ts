import { NextRequest } from "next/server";
import { HiveClient } from "@/app/utils/hive/hiveUtils";
import { err, isUuid, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { isAllowedModeratorHandle, verifyBindingSignature, type HiveAccountAuth } from "@/lib/coletivo/moderatorBinding";
import { bindModerator, getChallenge } from "@/lib/coletivo/store";

export const runtime = "nodejs";

async function getAccount(handle: string): Promise<HiveAccountAuth | null> {
  const accounts = (await HiveClient.database.getAccounts([handle])) as unknown as HiveAccountAuth[];
  return accounts?.[0] ?? null;
}

// Step 2: verify the Keychain signature over the stored challenge message, then
// let the DB consume the challenge and bind (handle -> user + email).
export async function POST(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const body = await req.json().catch(() => null);
  const challengeId = typeof body?.challenge_id === "string" ? body.challenge_id : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!isUuid(challengeId) || !signature) return err(400, "invalid_request");
  try {
    const c = await getChallenge(s.tokenHash, challengeId);
    if (!isAllowedModeratorHandle(c.hive_handle)) return err(403, "not_allowed");
    const v = await verifyBindingSignature({ message: c.message, signature, hiveHandle: c.hive_handle, getAccount });
    if (!v.ok) return err(v.status, v.code);
    const bound = await bindModerator(s.tokenHash, challengeId, v.publicKey);
    return json(200, { success: true, is_moderator: true, hive_handle: bound.hive_handle });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
