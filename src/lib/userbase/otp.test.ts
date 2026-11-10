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
});
