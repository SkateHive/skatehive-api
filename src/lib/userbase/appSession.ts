import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { getBearerToken, getUserPublic, hashToken } from "@/lib/userbase/session";
import type { AppClient } from "@/lib/userbase/appClient";

// Sessions issued to partner apps (e.g. coletivoxv). They live in their own
// table, userbase_app_sessions (skatehive3.0 sql/migrations/0036), NEVER in
// userbase_sessions: every first-party resolver (this API's
// resolveUserbaseUserId/getBearerUserId and the web app's many direct reads)
// only looks in userbase_sessions, so an app token can't vote, comment, post or
// touch keys anywhere. Only /auth/session and /auth/logout, called with the
// same app's credentials, read this table — and only through the 0036 RPCs.
//
// No fallback: if the RPC fails (e.g. migration not applied) the login fails.
// Issuing a first-party session instead would hand the partner Hive powers.

const APP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // RPC slides it, 90d cap
const APP_TOKEN_RE = /^[0-9a-f]{64}$/;

export type AppLoginMethod = "email_otp" | "email_signup" | "hive_claim";

type Issued = { ok: true; token: string; expiresAt: string };
type Refused = { ok: false; status: number; code: string; error: string };

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return data ? [data as T] : [];
}

/**
 * Record the login (membership) and issue an app session in one RPC call.
 * `email` MUST be the email the server just verified (OTP or signup token).
 */
export async function issueAppSession(params: {
  appId: string;
  userId: string;
  email: string;
  method: AppLoginMethod;
  userAgent?: string | null;
}): Promise<Issued | Refused> {
  if (!supabaseAdmin) {
    return { ok: false, status: 503, code: "app_login_unavailable", error: "App login is unavailable" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();
  try {
    const { data, error } = await supabaseAdmin.rpc("userbase_app_login", {
      p_user_id: params.userId,
      p_app: params.appId,
      p_email: params.email.toLowerCase(),
      p_token_hash: hashToken(token),
      p_expires_at: expiresAt,
      p_method: params.method,
      p_user_agent: params.userAgent ?? null,
    });
    if (error) {
      console.error("[userbase/appSession] app login rpc failed", error.code, error.message);
      if (error.code === "P0002") {
        return { ok: false, status: 403, code: "app_login_refused", error: "This account can't sign in here" };
      }
      return { ok: false, status: 503, code: "app_login_unavailable", error: "App login is unavailable, try again later" };
    }
    const session = rows<{ expires_at?: string }>(data)[0];
    if (!session) {
      return {
        ok: false,
        status: 403,
        code: "app_membership_revoked",
        error: "Access to this app has been revoked for this account",
      };
    }
    return { ok: true, token, expiresAt: session.expires_at || expiresAt };
  } catch (e) {
    console.error("[userbase/appSession] app login rpc threw", e);
    return { ok: false, status: 503, code: "app_login_unavailable", error: "App login is unavailable, try again later" };
  }
}

/** Bearer app token → user, for the app the caller authenticated as. */
export async function resolveAppSession(
  req: Request,
  appId: string
): Promise<{ userId: string; expiresAt: string } | null> {
  if (!supabaseAdmin) return null;
  const token = getBearerToken(req);
  if (!token || !APP_TOKEN_RE.test(token)) return null;
  try {
    const { data, error } = await supabaseAdmin.rpc("userbase_app_session_resolve", {
      p_token_hash: hashToken(token),
      p_app: appId,
    });
    if (error) {
      console.error("[userbase/appSession] resolve rpc failed", error.code, error.message);
      return null;
    }
    const row = rows<{ user_id: string; expires_at: string }>(data)[0];
    return row?.user_id ? { userId: row.user_id, expiresAt: row.expires_at } : null;
  } catch (e) {
    console.error("[userbase/appSession] resolve rpc threw", e);
    return null;
  }
}

/** Logout: revoke the bearer app token for that app. True if one was revoked. */
export async function revokeAppSession(req: Request, appId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const token = getBearerToken(req);
  if (!token || !APP_TOKEN_RE.test(token)) return false;
  const { data, error } = await supabaseAdmin.rpc("userbase_app_session_revoke", {
    p_token_hash: hashToken(token),
    p_app: appId,
  });
  if (error) {
    console.error("[userbase/appSession] revoke rpc failed", error.code, error.message);
    return false;
  }
  return data === true;
}

/**
 * For routes that verified an email and would issue a session: either a
 * first-party session (unchanged behaviour) or, for an authenticated partner
 * app, an app session. Returns the JSON response either way.
 */
export async function appLoginResponse(
  app: Extract<AppClient, { kind: "app" }>,
  params: { userId: string; email: string; method: AppLoginMethod; userAgent?: string | null }
): Promise<NextResponse> {
  const issued = await issueAppSession({ appId: app.appId, ...params });
  if (!issued.ok) {
    return NextResponse.json(
      { success: false, error: issued.error, code: issued.code },
      { status: issued.status }
    );
  }
  return NextResponse.json({
    success: true,
    token: issued.token,
    expires_at: issued.expiresAt,
    user: await getUserPublic(params.userId),
    app: { id: app.appId },
  });
}
