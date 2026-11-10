import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase } from "@/test/fakeSupabase";
import { sha256Hex } from "@/lib/userbase/appClient";

const SECRET = "coletivo-test-secret";
const sendOtpEmail = vi.fn(async () => {});
const createOtp = vi.fn(async () => "123456");

vi.mock("@/lib/userbase/email", () => ({ sendOtpEmail: (...a: unknown[]) => sendOtpEmail(...(a as [])) }));
vi.mock("@/lib/userbase/otp", () => ({ createOtp: (...a: unknown[]) => createOtp(...(a as [])) }));

let n = 0;
function req(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/userbase/auth/otp/request", {
    method: "POST",
    body: JSON.stringify(body),
    // A distinct end-user IP per test so the in-memory app limits don't interfere.
    headers: { "content-type": "application/json", "x-skatehive-end-user-ip": `10.0.0.${++n}`, ...headers },
  });
}

async function load() {
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({
    supabaseAdmin: makeFakeSupabase({ userbase_email_otps: [{ data: [], error: null }] }),
  }));
  vi.resetModules();
  return (await import("./route")).POST;
}

const coletivo = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": SECRET };
const lastBrand = () => (sendOtpEmail.mock.calls.at(-1) as unknown[] | undefined)?.[2];

describe("POST /api/userbase/auth/otp/request — email brand", () => {
  afterEach(() => {
    sendOtpEmail.mockClear();
    createOtp.mockClear();
    vi.unstubAllEnvs();
  });

  it("no app headers → Skatehive brand, first-party OTP", async () => {
    const POST = await load();
    const res = await POST(req({ email: "a@example.com" }));
    expect(res.status).toBe(200);
    expect(lastBrand()).toBe("skatehive");
    expect(createOtp).toHaveBeenCalledWith("a@example.com", null);
  });

  it("authenticated coletivoxv → Coletivo brand, app-bound OTP", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const POST = await load();
    const res = await POST(req({ email: "b@example.com" }, coletivo));
    expect(res.status).toBe(200);
    expect(lastBrand()).toBe("coletivoxv");
    expect(createOtp).toHaveBeenCalledWith("b@example.com", "coletivoxv");
  });

  it("another authenticated app → safe Skatehive fallback", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `otherapp:${sha256Hex("other-secret")}`);
    const POST = await load();
    const res = await POST(
      req({ email: "c@example.com" }, { "x-skatehive-app-id": "otherapp", "x-skatehive-app-secret": "other-secret" })
    );
    expect(res.status).toBe(200);
    expect(lastBrand()).toBe("skatehive");
  });

  it("spoof: brand/app in the body or Origin is ignored", async () => {
    const POST = await load();
    const res = await POST(
      req(
        { email: "d@example.com", brand: "coletivoxv", app: "coletivoxv", appId: "coletivoxv" },
        { origin: "https://coletivoxv.example", referer: "https://coletivoxv.example/entrar" }
      )
    );
    expect(res.status).toBe(200);
    expect(lastBrand()).toBe("skatehive");
    expect(createOtp).toHaveBeenCalledWith("d@example.com", null);
  });

  it("spoof: coletivoxv id with a wrong secret → 401, no OTP, no email", async () => {
    vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
    const POST = await load();
    const res = await POST(
      req({ email: "e@example.com" }, { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": "guess" })
    );
    expect(res.status).toBe(401);
    expect(createOtp).not.toHaveBeenCalled();
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });
});
