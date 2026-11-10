import { NextRequest } from "next/server";
import { json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { me } from "@/lib/coletivo/store";

export const runtime = "nodejs";

// Who is this coletivoxv app session, and is it a bound moderator?
export async function GET(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  try {
    const r = await me(s.tokenHash);
    return json(200, {
      success: true,
      user: { id: r.user_id, handle: r.handle, display_name: r.display_name, avatar_url: r.avatar_url },
      is_moderator: !!r.moderator_handle,
      moderator_handle: r.moderator_handle,
    });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
