import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, revokeSessionByToken } from "@/lib/userbase/session";
import { authenticateAppClient, INVALID_APP_CLIENT_BODY } from "@/lib/userbase/appClient";
import { revokeAppSession } from "@/lib/userbase/appSession";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") {
    return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  }
  if (app.kind === "app") {
    // Only that app's sessions; a first-party token is never touched here.
    await revokeAppSession(req, app.appId);
    return NextResponse.json({ success: true });
  }
  const token = getBearerToken(req);
  if (token) await revokeSessionByToken(token);
  return NextResponse.json({ success: true });
}
