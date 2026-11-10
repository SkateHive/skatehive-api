import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, revokeSessionByToken } from "@/lib/userbase/session";
import { authenticateAppClient, INVALID_APP_CLIENT_BODY } from "@/lib/userbase/appClient";
import { revokeAppSession, APP_UNAVAILABLE_BODY } from "@/lib/userbase/appSession";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") {
    return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  }
  if (app.kind === "app") {
    // Only that app's sessions; a first-party token is never touched here.
    // revoked=false: token was already invalid/expired/revoked (nothing live).
    // 503: revocation could not be confirmed — the token may still be live.
    const result = await revokeAppSession(req, app.appId);
    if (result === "unavailable") {
      return NextResponse.json(APP_UNAVAILABLE_BODY, { status: 503 });
    }
    return NextResponse.json({ success: true, revoked: result === "revoked" });
  }
  const token = getBearerToken(req);
  if (token) await revokeSessionByToken(token);
  return NextResponse.json({ success: true });
}
