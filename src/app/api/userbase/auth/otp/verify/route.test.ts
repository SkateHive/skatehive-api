import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeResult } from "@/test/fakeSupabase";
import { sha256Hex } from "@/lib/userbase/appClient";

const SECRET = "coletivo-test-secret";
const verifyOtp = vi.fn(async () => true);

vi.mock("@/lib/userbase/otp", () => ({ verifyOtp: (...a: unknown[]) => verifyOtp(...(a as [])) }));
vi.mock("@/lib/userbase/signupToken", () => ({ signSignupToken: () => "signup-token" }));

const coletivo = { "X-Skatehive-App-Id": "coletivoxv", "X-Skatehive-App-Secret": SECRET };

function req(extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/userbase/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ email: "Skater@Example.com", code: "123456" }),
    headers: { "content-type": "application/json", "user-agent": "coletivo-server", ...extraHeaders },
  });
}

async function load(appLogin: FakeResult[] = [{ data: [{ id: "s1", expires_at: "2026-12-09T00:00:00.000Z" }], error: null }], authMethods: FakeResult[] = [{ data: [{ user_id: "user-1" }], error: null }]) {
  const supabase = makeFakeSupabase({
    userbase_auth_methods: authMethods,
    userbase_sessions: [{ data: null, error: null }],
    userbase_users: [{ data: [{ id: "user-1", handle: "skater" }], error: null }],
    "rpc:userbase_app_login": appLogin,
  });
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: supabase }));
  vi.resetModules();
  const { POST } = await import("./route");
  return { POST, supabase };
}

const sessionInserts = (s: ReturnType<typeof makeFakeSupabase>) =>
  s.calls.filter((c) => c.table === "userbase_sessions" && c.method === "insert");
const appLoginCalls = (s: ReturnType<typeof makeFakeSupabase>) =>
  s.calls.filter((c) => c.table === "rpc:userbase_app_login");

describe("POST /api/userbase/auth/otp/verify — partner apps", () => {
  afterEach(() => {
    verifyOtp.mockClear();
    vi.unstubAllEnvs();
    vi.doUnmock("@/app/utils/supabase/supabaseClient");
  });

  it("first-party login: unchanged — userbase_sessions row, no app RPC, no app field", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST, supabase } = await load();
    const json = await (await POST(req())).json();
    expect(json.token).toBeTruthy();
    expect(json).not.toHaveProperty("app");
    expect(sessionInserts(supabase)).toHaveLength(1);
    expect(appLoginCalls(supabase)).toHaveLength(0);
  });

  it("partner app: scoped app session via RPC, never a first-party session", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST, supabase } = await load();
    const res = await POST(req(coletivo));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, app: { id: "coletivoxv" }, expires_at: "2026-12-09T00:00:00.000Z" });
    expect(json.token).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionInserts(supabase)).toHaveLength(0);
    const [call] = appLoginCalls(supabase);
    expect(call.args[0]).toMatchObject({
      p_user_id: "user-1",
      p_app: "coletivoxv",
      p_email: "skater@example.com", // the verified email, normalised
      p_token_hash: sha256Hex(json.token), // only the hash reaches the DB
      p_method: "email_otp",
      p_user_agent: "coletivo-server",
    });
  });

  it("forged app id (wrong secret): 401 before the OTP is consumed", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST, supabase } = await load();
    const res = await POST(req({ "X-Skatehive-App-Id": "coletivoxv", "X-Skatehive-App-Secret": "guess" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("invalid_app_client");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(supabase.calls).toHaveLength(0);
  });

  it("app not configured (env unset): app headers are refused", async () => {
    const { POST } = await load();
    expect((await POST(req(coletivo))).status).toBe(401);
  });

  it("migration missing / RPC error: 503, no token, no fallback session", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST, supabase } = await load([
      { data: null, error: { code: "PGRST202", message: "function not found" } },
    ]);
    const res = await POST(req(coletivo));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json).toMatchObject({ success: false, code: "app_login_unavailable" });
    expect(json).not.toHaveProperty("token");
    expect(sessionInserts(supabase)).toHaveLength(0);
  });

  it("revoked membership (0 rows): 403, no token", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST } = await load([{ data: [], error: null }]);
    const res = await POST(req(coletivo));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe("app_membership_revoked");
    expect(json).not.toHaveProperty("token");
  });

  it("email not bound / user inactive (P0002): 403, no token", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST } = await load([{ data: null, error: { code: "P0002", message: "no" } }]);
    const res = await POST(req(coletivo));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("app_login_refused");
  });

  it("new email via partner: signupRequired, nothing issued", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const { POST, supabase } = await load(undefined, [{ data: [], error: null }]);
    const json = await (await POST(req(coletivo))).json();
    expect(json).toMatchObject({ success: true, signupRequired: true, signupToken: "signup-token" });
    expect(appLoginCalls(supabase)).toHaveLength(0);
    expect(sessionInserts(supabase)).toHaveLength(0);
  });
});
