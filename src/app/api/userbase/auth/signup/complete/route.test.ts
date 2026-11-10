import { describe, expect, it, vi } from "vitest";
import { verifySignupToken } from "@/lib/userbase/signupToken";
import { NextRequest } from "next/server";
import { makeFakeSupabase } from "@/test/fakeSupabase";
import { sha256Hex } from "@/lib/userbase/appClient";

vi.mock("@/lib/userbase/signupToken", () => ({
  verifySignupToken: vi.fn(() => ({ email: "skater@example.com", app: null })),
}));

function req(body: unknown) {
  return new NextRequest("http://localhost/api/userbase/auth/signup/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/userbase/auth/signup/complete", () => {
  it("409s with code=hive_taken when the handle already exists on chain", async () => {
    vi.doMock("@/app/utils/supabase/supabaseClient", () => ({
      supabaseAdmin: makeFakeSupabase({}),
    }));
    vi.doMock("@/lib/userbase/hiveAccount", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/userbase/hiveAccount")>();
      return { ...actual, checkHiveAccountExists: vi.fn(async () => true) };
    });
    vi.resetModules();
    const { POST } = await import("./route");

    const res = await POST(req({ signupToken: "t", handle: "tonyhawk" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({
      success: false,
      code: "hive_taken",
      error: "That Hive username is already taken",
    });
  });

  it("409s with code=userbase_taken when the handle is already used in userbase", async () => {
    vi.doMock("@/app/utils/supabase/supabaseClient", () => ({
      supabaseAdmin: makeFakeSupabase({
        userbase_auth_methods: [{ data: [], error: null }],
        userbase_users: [{ data: [{ id: "existing-user" }], error: null }],
      }),
    }));
    vi.doMock("@/lib/userbase/hiveAccount", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/userbase/hiveAccount")>();
      return { ...actual, checkHiveAccountExists: vi.fn(async () => false) };
    });
    vi.resetModules();
    const { POST } = await import("./route");

    const res = await POST(req({ signupToken: "t", handle: "freshname" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({
      success: false,
      code: "userbase_taken",
      error: "That username is already in use",
    });
  });

  it("downgrade: an app-bound signup token without app headers is refused (no first-party session)", async () => {
    vi.mocked(verifySignupToken).mockReturnValueOnce({ email: "skater@example.com", app: "coletivoxv" });
    const supabase = makeFakeSupabase({});
    vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: supabase }));
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(req({ signupToken: "t", handle: "freshname" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("signup_context_mismatch");
    expect(supabase.calls).toHaveLength(0);
  });

  it("partner-app signup: new account + scoped app session (email_signup), no first-party session", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex("s3cret")}`);
    vi.mocked(verifySignupToken).mockReturnValueOnce({ email: "skater@example.com", app: "coletivoxv" });
    const supabase = makeFakeSupabase({
      userbase_auth_methods: [{ data: [], error: null }, { data: null, error: null }],
      userbase_users: [
        { data: [], error: null },
        { data: { id: "new-user" }, error: null },
        { data: [{ id: "new-user", handle: "freshname" }], error: null },
      ],
      "rpc:userbase_app_login": [{ data: [{ id: "s1", expires_at: "2026-12-09T00:00:00.000Z" }], error: null }],
    });
    vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: supabase }));
    vi.doMock("@/lib/userbase/hiveAccount", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/userbase/hiveAccount")>();
      return { ...actual, checkHiveAccountExists: vi.fn(async () => false) };
    });
    vi.resetModules();
    const { POST } = await import("./route");

    const r = new NextRequest("http://localhost/api/userbase/auth/signup/complete", {
      method: "POST",
      body: JSON.stringify({ signupToken: "t", handle: "freshname" }),
      headers: {
        "content-type": "application/json",
        "x-skatehive-app-id": "coletivoxv",
        "x-skatehive-app-secret": "s3cret",
      },
    });
    const res = await POST(r);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.app).toEqual({ id: "coletivoxv" });
    expect(supabase.calls.some((c) => c.table === "userbase_sessions")).toBe(false);
    const rpc = supabase.calls.find((c) => c.table === "rpc:userbase_app_login");
    expect(rpc?.args[0]).toMatchObject({
      p_user_id: "new-user",
      p_app: "coletivoxv",
      p_email: "skater@example.com",
      p_method: "email_signup",
    });
    vi.unstubAllEnvs();
  });
});
