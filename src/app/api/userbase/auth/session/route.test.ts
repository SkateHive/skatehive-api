import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeResult } from "@/test/fakeSupabase";
import { sha256Hex } from "@/lib/userbase/appClient";

const SECRET = "coletivo-test-secret";
const APP_TOKEN = "a".repeat(64);
const coletivo = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": SECRET };

function get(path: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

async function load(responses: Record<string, FakeResult[]>) {
  const supabase = makeFakeSupabase(responses);
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: supabase }));
  vi.resetModules();
  return {
    supabase,
    session: (await import("./route")).GET,
    logout: (await import("../logout/route")).POST,
    sessionLib: await import("@/lib/userbase/session"),
  };
}

describe("app sessions are isolated from first-party sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/app/utils/supabase/supabaseClient");
  });

  it("GET session with app credentials resolves only via the app RPC, bound to that app", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { session, supabase } = await load({
      "rpc:userbase_app_session_resolve": [
        { data: [{ session_id: "s1", user_id: "user-1", expires_at: "2026-12-09T00:00:00.000Z" }], error: null },
      ],
      userbase_users: [{ data: [{ id: "user-1", handle: "skater" }], error: null }],
    });
    const res = await session(get("/api/userbase/auth/session", { authorization: `Bearer ${APP_TOKEN}`, ...coletivo }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, user: { id: "user-1" }, app: { id: "coletivoxv" } });
    const rpc = supabase.calls.find((c) => c.method === "rpc");
    expect(rpc?.args[0]).toEqual({ p_token_hash: sha256Hex(APP_TOKEN), p_app: "coletivoxv" });
    expect(supabase.calls.some((c) => c.table === "userbase_sessions")).toBe(false);
  });

  it("an app token presented WITHOUT app credentials only hits userbase_sessions → 401", async () => {
    const { session, supabase, sessionLib } = await load({
      userbase_sessions: [{ data: [], error: null }],
    });
    const res = await session(get("/api/userbase/auth/session", { authorization: `Bearer ${APP_TOKEN}` }));
    expect(res.status).toBe(401);
    // The resolver every Hive route uses (vote, comment, upload…) — same story.
    const req = new Request("http://localhost/x", { headers: { authorization: `Bearer ${APP_TOKEN}` } });
    expect(await sessionLib.resolveUserbaseUserId(req)).toBeNull();
    expect(await sessionLib.getBearerUserId(req)).toBeNull();
    expect(supabase.calls.some((c) => c.method === "rpc")).toBe(false);
  });

  it("a first-party token presented WITH app credentials is not resolved as first-party", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { session, supabase } = await load({
      "rpc:userbase_app_session_resolve": [{ data: [], error: null }],
    });
    const res = await session(
      get("/api/userbase/auth/session", { authorization: "Bearer 0b9e3c1e-uuid-first-party", ...coletivo })
    );
    expect(res.status).toBe(401);
    expect(supabase.calls.some((c) => c.table === "userbase_sessions")).toBe(false);
  });

  it("resolve RPC missing (migration not applied) → 401, no fallback", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { session, supabase } = await load({
      "rpc:userbase_app_session_resolve": [{ data: null, error: { code: "PGRST202", message: "missing" } }],
    });
    const res = await session(get("/api/userbase/auth/session", { authorization: `Bearer ${APP_TOKEN}`, ...coletivo }));
    expect(res.status).toBe(401);
    expect(supabase.calls.some((c) => c.table === "userbase_sessions")).toBe(false);
  });

  it("logout with app credentials revokes only via the app RPC", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { logout, supabase } = await load({ "rpc:userbase_app_session_revoke": [{ data: true, error: null }] });
    const res = await logout(
      new NextRequest("http://localhost/api/userbase/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${APP_TOKEN}`, ...coletivo },
      })
    );
    expect(res.status).toBe(200);
    const rpc = supabase.calls.find((c) => c.method === "rpc");
    expect(rpc?.table).toBe("rpc:userbase_app_session_revoke");
    expect(rpc?.args[0]).toEqual({ p_token_hash: sha256Hex(APP_TOKEN), p_app: "coletivoxv" });
    expect(supabase.calls.some((c) => c.table === "userbase_sessions")).toBe(false);
  });

  it("invalid app credentials → 401 on session and logout", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { session, logout } = await load({});
    const bad = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": "nope", authorization: `Bearer ${APP_TOKEN}` };
    expect((await session(get("/api/userbase/auth/session", bad))).status).toBe(401);
    expect(
      (await logout(new NextRequest("http://localhost/api/userbase/auth/logout", { method: "POST", headers: bad }))).status
    ).toBe(401);
  });
});
