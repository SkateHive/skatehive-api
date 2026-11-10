import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase } from "@/test/fakeSupabase";

// Store whatever createOtp inserts, then hand it back to verifyOtp.
async function issueThenVerify(issueApp: string | null, verifyApp: string | null) {
  const insertSpy = makeFakeSupabase({ userbase_email_otps: [{ data: null, error: null }] });
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: insertSpy }));
  vi.resetModules();
  const { createOtp } = await import("./otp");
  const code = await createOtp("Skater@Example.com", issueApp);
  const row = insertSpy.calls.find((c) => c.method === "insert")!.args[0];

  const verifyDb = makeFakeSupabase({
    userbase_email_otps: [
      { data: [{ id: "o1", code_hash: row.code_hash, attempts: 0, expires_at: row.expires_at, consumed_at: null }], error: null },
      { data: [{ id: "o1" }], error: null },
    ],
  });
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: verifyDb }));
  vi.resetModules();
  const { verifyOtp } = await import("./otp");
  return verifyOtp("skater@example.com", code, verifyApp);
}

describe("OTP codes are bound to the client that requested them", () => {
  afterEach(() => vi.doUnmock("@/app/utils/supabase/supabaseClient"));

  it("first-party code verifies first-party (unchanged)", async () => {
    expect(await issueThenVerify(null, null)).toBe(true);
  });
  it("app code verifies for the same app", async () => {
    expect(await issueThenVerify("coletivoxv", "coletivoxv")).toBe(true);
  });
  it("downgrade: app code can't be redeemed first-party", async () => {
    expect(await issueThenVerify("coletivoxv", null)).toBe(false);
  });
  it("app code can't be redeemed by another app, nor first-party code by an app", async () => {
    expect(await issueThenVerify("coletivoxv", "otherapp")).toBe(false);
    expect(await issueThenVerify(null, "coletivoxv")).toBe(false);
  });

  it("keeps simultaneous first-party and partner codes and attempt budgets independent", async () => {
    const rows: any[] = [];
    // Stateful store applies the query predicates: a canned row would not
    // detect accidentally selecting the newest code from another app.
    const db = {
      from: () => {
        const predicates: ((r: any) => boolean)[] = [];
        let patch: any;
        let insert: any;
        let limit: number | undefined;
        const q: any = {
          select: () => q,
          eq: (key: string, value: unknown) => { predicates.push(r => r[key] === value); return q; },
          is: (key: string, value: unknown) => { predicates.push(r => r[key] === value); return q; },
          order: () => q,
          limit: (n: number) => { limit = n; return q; },
          insert: (r: any) => { insert = r; return q; },
          update: (p: any) => { patch = p; return q; },
          then: (resolve: any) => {
            if (insert) rows.push({ id: String(rows.length), consumed_at: null, ...insert });
            let selected = [...rows].reverse().filter(r => predicates.every(p => p(r)));
            if (limit !== undefined) selected = selected.slice(0, limit);
            if (patch) selected.forEach(r => Object.assign(r, patch));
            return Promise.resolve({ data: selected.map(r => ({ ...r })), error: null }).then(resolve);
          },
        };
        return q;
      },
    };
    vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: db }));
    vi.resetModules();
    const { createOtp, verifyOtp } = await import("./otp");
    const first = await createOtp("same@example.com", null);
    const partner = await createOtp("same@example.com", "coletivoxv");
    expect(rows.map(r => r.app_id)).toEqual(["", "coletivoxv"]);
    expect(await verifyOtp("same@example.com", "not-a-code", null)).toBe(false);
    expect(rows.map(r => r.attempts)).toEqual([1, 0]);
    expect(await verifyOtp("same@example.com", first, null)).toBe(true);
    expect(rows[1].consumed_at).toBeNull();
    expect(await verifyOtp("same@example.com", partner, "coletivoxv")).toBe(true);
    expect(await verifyOtp("same@example.com", first, null)).toBe(false);
  });
});
