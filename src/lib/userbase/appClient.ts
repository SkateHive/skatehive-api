import crypto from "crypto";

// Partner app clients (e.g. the Coletivo XV site) that log users in to the
// shared userbase through their own server. A client proves who it is with a
// secret only its server holds, so a browser — or another client — can't
// claim to be it.
//
// Config: USERBASE_APP_CLIENTS="coletivoxv:<sha256 hex of secret>,other:<hex>"
// Only the hash lives in our env; the raw secret lives in the partner's env.
// Generate one with:  openssl rand -hex 32  →  echo -n <secret> | shasum -a 256
//
// Request headers (server-to-server only, never from a browser):
//   X-Skatehive-App-Id:     coletivoxv
//   X-Skatehive-App-Secret: <raw secret>
//   X-Skatehive-End-User-Ip: <browser IP>   (optional, used for rate limits)

export const APP_ID_HEADER = "x-skatehive-app-id";
export const APP_SECRET_HEADER = "x-skatehive-app-secret";
export const END_USER_IP_HEADER = "x-skatehive-end-user-ip";

const APP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export type AppClient =
  | { kind: "none" } // no app headers: first-party client, behaviour unchanged
  | { kind: "app"; appId: string }
  | { kind: "invalid" }; // app headers sent but wrong: reject the request

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Parse USERBASE_APP_CLIENTS into appId → secret hash. Bad entries are skipped. */
export function parseAppClients(raw: string | undefined): Map<string, string> {
  const clients = new Map<string, string>();
  for (const entry of (raw || "").split(",")) {
    const [id, hash] = entry.trim().split(":").map((s) => (s || "").trim());
    if (APP_ID_RE.test(id || "") && HASH_RE.test((hash || "").toLowerCase())) {
      clients.set(id, hash.toLowerCase());
    }
  }
  return clients;
}

export function authenticateAppClient(
  headers: Headers,
  rawConfig: string | undefined = process.env.USERBASE_APP_CLIENTS
): AppClient {
  const appId = (headers.get(APP_ID_HEADER) || "").trim();
  const secret = headers.get(APP_SECRET_HEADER) || "";
  if (!appId && !secret) return { kind: "none" };
  if (!appId || !secret) return { kind: "invalid" };

  const expected = parseAppClients(rawConfig).get(appId);
  if (!expected) return { kind: "invalid" };

  const given = Buffer.from(sha256Hex(secret), "hex");
  const want = Buffer.from(expected, "hex");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { kind: "invalid" };
  }
  return { kind: "app", appId };
}

/**
 * Rate-limit key IP. A partner server proxies every user from one IP, so for
 * an authenticated app we trust its forwarded end-user IP (and namespace it by
 * app so it can't collide with first-party keys). Everyone else: x-real-ip.
 */
export function rateLimitIp(req: Request, app: AppClient): string {
  if (app.kind === "app") {
    const endUser = (req.headers.get(END_USER_IP_HEADER) || "").trim().slice(0, 64);
    if (endUser) return `${app.appId}:${endUser}`;
    return `${app.appId}:${req.headers.get("x-real-ip") || "unknown"}`;
  }
  return req.headers.get("x-real-ip") || "unknown";
}

/** The app id a request is acting as (null = first-party). */
export function appIdOf(app: AppClient): string | null {
  return app.kind === "app" ? app.appId : null;
}

export const SIGNUP_CONTEXT_MISMATCH_BODY = {
  success: false,
  error: "Signup session expired — request a new code",
  code: "signup_context_mismatch",
} as const;

export const RATE_LIMITED_BODY = {
  success: false,
  error: "Too many attempts, try again later",
  code: "rate_limited",
} as const;

export const INVALID_APP_CLIENT_BODY = {
  success: false,
  error: "Invalid app client credentials",
  code: "invalid_app_client",
} as const;
