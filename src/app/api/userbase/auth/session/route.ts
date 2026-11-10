import { NextRequest, NextResponse } from "next/server";
import { resolveUserbaseUserId, getUserPublic } from "@/lib/userbase/session";
import { authenticateAppClient, INVALID_APP_CLIENT_BODY } from "@/lib/userbase/appClient";
import { resolveAppSession, APP_UNAVAILABLE_BODY } from "@/lib/userbase/appSession";

export const runtime = "nodejs";

const unauthorized = () =>
  NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

// Validate a session token → current user. With partner app credentials, the
// token is looked up ONLY among that app's sessions (userbase_app_sessions);
// without them, ONLY among first-party sessions. The two never cross.
export async function GET(req: NextRequest) {
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") {
    return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  }

  let userId: string | null;
  let expiresAt: string | undefined;
  if (app.kind === "app") {
    const session = await resolveAppSession(req, app.appId);
    // Outage ≠ bad token: 503 tells the app to keep its cookie and retry.
    if (session.status === "unavailable") {
      return NextResponse.json(APP_UNAVAILABLE_BODY, { status: 503 });
    }
    userId = session.status === "ok" ? session.userId : null;
    expiresAt = session.status === "ok" ? session.expiresAt : undefined;
  } else {
    userId = await resolveUserbaseUserId(req);
  }
  if (!userId) return unauthorized();

  const user = await getUserPublic(userId);
  if (!user) return unauthorized();
  if (app.kind === "app") {
    return NextResponse.json({ success: true, user, expires_at: expiresAt, app: { id: app.appId } });
  }
  return NextResponse.json({ success: true, user });
}
