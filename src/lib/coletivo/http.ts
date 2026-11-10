import { NextResponse } from "next/server";
import { authenticateAppClient, INVALID_APP_CLIENT_BODY } from "@/lib/userbase/appClient";
import { getBearerToken, hashToken } from "@/lib/userbase/session";
import { COLETIVO_APP_ID } from "./config";
import { StoreError } from "./store";

// Request guards for the Coletivo community routes. Every route requires the
// coletivoxv app credential (server-to-server). Session routes additionally
// require a coletivoxv APP session token, passed to the DB only as its hash;
// a first-party Skatehive session is never accepted or converted here.

const APP_TOKEN_RE = /^[0-9a-f]{64}$/;

export function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export function err(status: number, code: string, error?: string) {
  return json(status, { success: false, code, error: error || code });
}

export function requireColetivoApp(req: Request): NextResponse | null {
  const app = authenticateAppClient(req.headers);
  if (app.kind === "invalid") return NextResponse.json(INVALID_APP_CLIENT_BODY, { status: 401 });
  if (app.kind !== "app" || app.appId !== COLETIVO_APP_ID) return err(403, "app_not_allowed");
  return null;
}

/** Hash of the coletivoxv app session token, or a 401 response. */
export function requireSessionHash(req: Request): { tokenHash: string } | { response: NextResponse } {
  const denied = requireColetivoApp(req);
  if (denied) return { response: denied };
  const token = getBearerToken(req);
  if (!token || !APP_TOKEN_RE.test(token)) return { response: err(401, "unauthorized") };
  return { tokenHash: hashToken(token) };
}

export function storeErrorResponse(e: unknown) {
  if (e instanceof StoreError) return err(e.status, e.code);
  console.error("[coletivo] unexpected", (e as { name?: string })?.name || "unknown");
  return err(503, "unavailable");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | undefined | null) => !!s && UUID_RE.test(s);
