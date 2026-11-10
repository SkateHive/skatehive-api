import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/userbase/otp";
import { createSession, getUserPublic } from "@/lib/userbase/session";
import { signSignupToken } from "@/lib/userbase/signupToken";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import {
  authenticateAppClient,
  appIdOf,
  rateLimitIp,
  INVALID_APP_CLIENT_BODY,
  RATE_LIMITED_BODY,
} from "@/lib/userbase/appClient";
import { isRateLimited, recordAttempt } from "@/lib/userbase/rateLimit";
import { appLoginResponse } from "@/lib/userbase/appSession";

export const runtime = "nodejs";

// Failed-attempt cap per end user for partner apps (each code also has its
// own 5-attempt cap in otp.ts).
const APP_IP_FAIL_LIMIT = 20;
const APP_IP_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Userbase backend not configured" },
      { status: 500 }
    );
  }
  // Partner app credentials are checked before the code is consumed; a bad one is refused outright.
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") {
    return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { success: false, error: "Email and a 6-digit code are required" },
      { status: 400 }
    );
  }

  const ipKey = app.kind === "app" ? `otp-verify:ip:${rateLimitIp(req, app)}` : null;
  if (ipKey && isRateLimited(ipKey, APP_IP_FAIL_LIMIT, APP_IP_WINDOW_MS)) {
    return NextResponse.json(RATE_LIMITED_BODY, { status: 429 });
  }

  // A code issued for an app only verifies for that same app (and vice versa).
  const ok = await verifyOtp(email, code, appIdOf(app));
  if (!ok) {
    if (ipKey) recordAttempt(ipKey, APP_IP_WINDOW_MS);
    return NextResponse.json(
      { success: false, error: "Invalid or expired code" },
      { status: 401 }
    );
  }

  // Existing account for this email? → log in.
  const { data: methods } = await supabaseAdmin
    .from("userbase_auth_methods")
    .select("user_id")
    .eq("type", "email_magic")
    .eq("identifier", email)
    .limit(1);
  const userId = methods?.[0]?.user_id;

  if (userId && app.kind === "app") {
    // Scoped app session (no Hive powers), never a first-party session.
    return appLoginResponse(app, {
      userId,
      email,
      method: "email_otp",
      userAgent: req.headers.get("user-agent"),
    });
  }

  if (userId) {
    const { token, expiresAt } = await createSession(userId, req.headers.get("user-agent"));
    const user = await getUserPublic(userId);
    return NextResponse.json({ success: true, token, expires_at: expiresAt, user });
  }

  // New email → must choose a username next. Hand back a short-lived signed token.
  const signupToken = signSignupToken(email, appIdOf(app));
  return NextResponse.json({ success: true, signupRequired: true, signupToken });
}
