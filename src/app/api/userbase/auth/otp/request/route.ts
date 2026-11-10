import { NextRequest, NextResponse } from "next/server";
import { createOtp } from "@/lib/userbase/otp";
import { sendOtpEmail } from "@/lib/userbase/email";
import { brandForApp } from "@/lib/userbase/otpEmailTemplate";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import {
  authenticateAppClient,
  appIdOf,
  rateLimitIp,
  INVALID_APP_CLIENT_BODY,
  RATE_LIMITED_BODY,
} from "@/lib/userbase/appClient";
import { isRateLimited, recordAttempt } from "@/lib/userbase/rateLimit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_THROTTLE_SECONDS = 30;
// Extra limits for partner apps, whose server sends every user from one IP.
const APP_IP_LIMIT = 10;
const APP_EMAIL_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Userbase backend not configured" },
      { status: 500 }
    );
  }
  // Partner app headers are optional; if sent they must be valid.
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") {
    return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { success: false, error: "A valid email is required" },
      { status: 400 }
    );
  }

  if (app.kind === "app") {
    const ipKey = `otp-req:ip:${rateLimitIp(req, app)}`;
    const emailKey = `otp-req:email:${app.appId}:${email}`;
    if (isRateLimited(ipKey, APP_IP_LIMIT, HOUR_MS) || isRateLimited(emailKey, APP_EMAIL_LIMIT, HOUR_MS)) {
      return NextResponse.json(RATE_LIMITED_BODY, { status: 429 });
    }
    recordAttempt(ipKey, HOUR_MS);
    recordAttempt(emailKey, HOUR_MS);
  }

  // Resend throttle is independent for each authenticated app / first-party.
  const { data: recent } = await supabaseAdmin
    .from("userbase_email_otps")
    .select("created_at")
    .eq("email", email)
    .eq("app_id", appIdOf(app) ?? "")
    .order("created_at", { ascending: false })
    .limit(1);
  const last = recent?.[0]?.created_at;
  if (last && Date.now() - new Date(last).getTime() < RESEND_THROTTLE_SECONDS * 1000) {
    return NextResponse.json(
      { success: false, error: "Please wait a moment before requesting another code" },
      { status: 429 }
    );
  }

  try {
    const code = await createOtp(email, appIdOf(app));
    // Brand comes only from the authenticated app, never from the body/Origin.
    await sendOtpEmail(email, code, brandForApp(app));
  } catch (e) {
    console.error("[userbase/auth/otp/request] failed", e);
    return NextResponse.json(
      { success: false, error: "Could not send the code, try again" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, expires_in: 600 });
}
