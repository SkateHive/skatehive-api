import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/userbase/otp";
import { createSession, getUserPublic } from "@/lib/userbase/session";
import { signSignupToken } from "@/lib/userbase/signupToken";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Userbase backend not configured" },
      { status: 500 }
    );
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

  const ok = await verifyOtp(email, code);
  if (!ok) {
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

  if (userId) {
    const { token, expiresAt } = await createSession(userId, req.headers.get("user-agent"));
    const user = await getUserPublic(userId);
    return NextResponse.json({ success: true, token, expires_at: expiresAt, user });
  }

  // New email → must choose a username next. Hand back a short-lived signed token.
  const signupToken = signSignupToken(email);
  return NextResponse.json({ success: true, signupRequired: true, signupToken });
}
