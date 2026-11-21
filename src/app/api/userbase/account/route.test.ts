import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeCall, type FakeResult } from "@/test/fakeSupabase";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/userbase/account", {
    method: "DELETE",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: "Bearer tok", ...headers },
  });
}

async function loadRoute(opts: {
  supabase?: Record<string, FakeResult[]> | null;
  userId?: string | null;
  appClient?: "none" | "app" | "invalid";
}) {
  const getBearerUserId = vi.fn(async () => (opts.userId === undefined ? "user-1" : opts.userId));
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({
    supabaseAdmin: opts.supabase === null ? null : makeFakeSupabase(opts.supabase || {}),
  }));
  vi.doMock("@/lib/userbase/session", () => ({ getBearerUserId }));
  vi.doMock("@/lib/userbase/appClient", () => ({
    authenticateAppClient: vi.fn(() =>
      opts.appClient === "app" ? { kind: "app", appId: "coletivoxv" } : { kind: opts.appClient || "none" }
    ),
  }));
  vi.resetModules();
  const { DELETE } = await import("./route");
  const { supabaseAdmin } = await import("@/app/utils/supabase/supabaseClient");
  return { DELETE, getBearerUserId, calls: ((supabaseAdmin as any)?.calls || []) as FakeCall[] };
}

const rpcCalls = (calls: FakeCall[]) => calls.filter((c) => c.method === "rpc");

afterEach(() => vi.restoreAllMocks());

describe("DELETE /api/userbase/account", () => {
  it("deletes the session's user in one RPC and returns 200", async () => {
    const { DELETE, calls } = await loadRoute({
      supabase: { "rpc:userbase_account_delete": [{ data: true, error: null }] },
    });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(rpcCalls(calls)).toEqual([
      { table: "rpc:userbase_account_delete", method: "rpc", args: [{ p_user_id: "user-1" }] },
    ]);
    expect(calls.filter((c) => c.method !== "rpc")).toEqual([]); // no direct table writes
  });

  it("401s without a valid session and deletes nothing", async () => {
    const { DELETE, calls } = await loadRoute({ userId: null });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(401);
    expect(rpcCalls(calls)).toEqual([]);
  });

  it("401s when the user is already gone (function returns false)", async () => {
    const { DELETE } = await loadRoute({
      supabase: { "rpc:userbase_account_delete": [{ data: false, error: null }] },
    });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(401);
  });

  it.each([[{}], [{ confirm: "delete" }], [{ confirm: true }], ["not json"], [null]])(
    "400s without confirm:DELETE (%j) before touching the session",
    async (body) => {
      const { DELETE, getBearerUserId, calls } = await loadRoute({});
      const res = await DELETE(req(body));
      expect(res.status).toBe(400);
      expect(getBearerUserId).not.toHaveBeenCalled();
      expect(rpcCalls(calls)).toEqual([]);
    }
  );

  it.each(["app", "invalid"] as const)("403s partner-app callers (%s credentials)", async (appClient) => {
    const { DELETE, getBearerUserId, calls } = await loadRoute({ appClient });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(403);
    expect(getBearerUserId).not.toHaveBeenCalled();
    expect(rpcCalls(calls)).toEqual([]);
  });

  it("503s when the migration is not applied yet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { DELETE } = await loadRoute({
      supabase: { "rpc:userbase_account_delete": [{ data: null, error: { code: "PGRST202", message: "x" } }] },
    });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(503);
  });

  it("500s when the delete fails, without logging the user id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { DELETE } = await loadRoute({
      supabase: { "rpc:userbase_account_delete": [{ data: null, error: { code: "23503", message: "fk user-1" } }] },
    });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain("user-1");
  });

  it("503s when the backend is not configured", async () => {
    const { DELETE } = await loadRoute({ supabase: null });
    const res = await DELETE(req({ confirm: "DELETE" }));
    expect(res.status).toBe(503);
  });
});
