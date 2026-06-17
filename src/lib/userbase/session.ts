import crypto from "crypto";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Mirrors the web app's userbase session model (app/api/userbase/auth/*),
// EXCEPT the token is delivered to the client as a bearer token (JSON body +
// Authorization header) instead of an httpOnly cookie — so React Native can use
// it. The DB shape (userbase_sessions) is identical, so web cookies and mobile
// bearer tokens are interchangeable session rows.

const SESSION_TTL_DAYS = 30;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Create a session row and return the raw opaque token (store its hash only). */
export async function createSession(
  userId: string,
  userAgent?: string | null
): Promise<{ token: string; expiresAt: string }> {
  if (!supabaseAdmin) throw new Error("Userbase backend not configured");
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { error } = await supabaseAdmin.from("userbase_sessions").insert({
    user_id: userId,
    refresh_token_hash: hashToken(token),
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    user_agent: userAgent ?? null,
  });
  if (error) throw new Error(`Session insert failed: ${error.message}`);
  return { token, expiresAt };
}

/** Extract the bearer token from a request, or null. */
export function getBearerToken(req: Request): string | null {
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/** Validate the bearer token → user_id, or null if missing/expired/revoked. */
export async function getBearerUserId(req: Request): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const token = getBearerToken(req);
  if (!token) return null;
  const { data } = await supabaseAdmin
    .from("userbase_sessions")
    .select("id, user_id, expires_at, revoked_at")
    .eq("refresh_token_hash", hashToken(token))
    .is("revoked_at", null)
    .limit(1);
  const session = data?.[0];
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session.user_id as string;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("userbase_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("refresh_token_hash", hashToken(token));
}

/** Fetch the public user profile for a session response. */
export async function getUserPublic(userId: string) {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("userbase_users")
    .select("id, handle, display_name, avatar_url, status, onboarding_step")
    .eq("id", userId)
    .limit(1);
  return data?.[0] ?? null;
}
