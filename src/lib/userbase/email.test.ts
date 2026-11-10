import { describe, expect, it } from "vitest";
import { isOtpDevLogEnabled } from "./email";

describe("isOtpDevLogEnabled", () => {
  it("is on only when asked for outside production", () => {
    expect(isOtpDevLogEnabled({ NODE_ENV: "development", USERBASE_OTP_DEV_LOG: "1" } as any)).toBe(true);
    expect(isOtpDevLogEnabled({ NODE_ENV: "development" } as any)).toBe(false);
  });
  it("can never be on in production", () => {
    expect(isOtpDevLogEnabled({ NODE_ENV: "production", USERBASE_OTP_DEV_LOG: "1" } as any)).toBe(false);
    expect(
      isOtpDevLogEnabled({ NODE_ENV: "development", VERCEL_ENV: "production", USERBASE_OTP_DEV_LOG: "1" } as any)
    ).toBe(false);
  });
});

describe("sendOtpEmail", () => {
  it("uses the same SMTP address for every brand; only the display name and content change", async () => {
    const { vi } = await import("vitest");
    const sendMail = vi.fn(async () => ({}));
    vi.doMock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
    vi.stubEnv("EMAIL_USER", "sender@example.com");
    vi.stubEnv("USERBASE_OTP_DEV_LOG", "");
    vi.resetModules();
    const { sendOtpEmail } = await import("./email");
    await sendOtpEmail("to@example.com", "123456");
    await sendOtpEmail("to@example.com", "123456", "coletivoxv");
    const [sk, cx] = sendMail.mock.calls.map((c) => (c as unknown as [any])[0]);
    expect(sk.from).toEqual({ name: "Skatehive", address: "sender@example.com" });
    expect(cx.from).toEqual({ name: "Coletivo XV", address: "sender@example.com" });
    expect(sk.subject).toBe("Your Skatehive login code");
    expect(cx.subject).toBe("Seu código para entrar no Coletivo XV");
    expect(cx.html).toContain("#da2922");
    expect(cx.text).toContain("123456");
    vi.doUnmock("nodemailer");
    vi.unstubAllEnvs();
  });
});
