import { NextRequest, NextResponse } from "next/server";
import { createOtp } from "@/lib/userbase/otp";
import { sendOtpEmail } from "@/lib/userbase/email";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_THROTTLE_SECONDS = 30;

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Userbase backend not configured" },
      { status: 500 }
    );
  }
  const body = await req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { success: false, error: "A valid email is required" },
      { status: 400 }
    );
  }

  // Light resend throttle: one code per email per 30s.
  const { data: recent } = await supabaseAdmin
    .from("userbase_email_otps")
    .select("created_at")
    .eq("email", email)
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
    const code = await createOtp(email);
    await sendOtpEmail(email, code);
  } catch (e) {
    console.error("[userbase/auth/otp/request] failed", e);
    return NextResponse.json(
      { success: false, error: "Could not send the code, try again" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, expires_in: 600 });
}
