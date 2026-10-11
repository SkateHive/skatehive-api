import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase, type FakeResult } from "@/test/fakeSupabase";

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadSession(sessions: FakeResult[]) {
  const supabase = makeFakeSupabase({ userbase_sessions: sessions });
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({
    supabaseAdmin: supabase,
  }));
  const mod = await import("./session");
  return { mod, supabase };
}

function bearer(token: string) {
  return new Request("https://api.test/x", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function sessionRow(expiresInMs: number) {
  return {
    id: "session-1",
    user_id: "user-1",
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    revoked_at: null,
  };
}

const updates = (supabase: ReturnType<typeof makeFakeSupabase>) =>
  supabase.calls.filter((c) => c.method === "update");

describe("userbase sessions", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/app/utils/supabase/supabaseClient");
  });

  it("accepts a fresh session without writing", async () => {
    const { mod, supabase } = await loadSession([
      { data: [sessionRow(30 * DAY_MS - 60_000)], error: null },
    ]);

    await expect(mod.getBearerUserId(bearer("t"))).resolves.toBe("user-1");
    expect(updates(supabase)).toHaveLength(0);
  });

  it("pushes the expiry back to 30 days when a day-old session is used", async () => {
    const { mod, supabase } = await loadSession([
      { data: [sessionRow(5 * DAY_MS)], error: null },
      { data: null, error: null },
    ]);

    await expect(mod.getBearerUserId(bearer("t"))).resolves.toBe("user-1");
    const [update] = updates(supabase);
    const newExpiry = new Date(update.args[0].expires_at).getTime();
    expect(newExpiry - Date.now()).toBeGreaterThan(29 * DAY_MS);
    expect(supabase.calls).toContainEqual({
      table: "userbase_sessions",
      method: "eq",
      args: ["id", "session-1"],
    });
  });

  it("still authenticates when extending fails", async () => {
    const { mod } = await loadSession([
      { data: [sessionRow(DAY_MS)], error: null },
      { data: null, error: { message: "boom" } },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mod.getBearerUserId(bearer("t"))).resolves.toBe("user-1");
    warn.mockRestore();
  });

  it("rejects an expired session and does not revive it", async () => {
    const { mod, supabase } = await loadSession([
      { data: [sessionRow(-60_000)], error: null },
    ]);

    await expect(mod.getBearerUserId(bearer("t"))).resolves.toBeNull();
    expect(updates(supabase)).toHaveLength(0);
  });

  it("rejects an unknown or revoked token", async () => {
    const { mod } = await loadSession([{ data: [], error: null }]);

    await expect(mod.getBearerUserId(bearer("t"))).resolves.toBeNull();
  });
});
