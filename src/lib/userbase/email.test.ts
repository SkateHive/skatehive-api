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
