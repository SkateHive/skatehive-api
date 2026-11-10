import { describe, expect, it } from "vitest";
import {
  authenticateAppClient,
  parseAppClients,
  rateLimitIp,
  sha256Hex,
} from "./appClient";

const SECRET = "coletivo-test-secret";
const CONFIG = `coletivoxv:${sha256Hex(SECRET)}`;

function headers(h: Record<string, string>) {
  return new Headers(h);
}

describe("parseAppClients", () => {
  it("parses id:hash pairs and skips malformed entries", () => {
    const m = parseAppClients(` coletivoxv:${sha256Hex("a")} , bad , UPPER:${sha256Hex("b")}, x:nothex`);
    expect([...m.keys()]).toEqual(["coletivoxv"]);
  });
  it("is empty when unset", () => {
    expect(parseAppClients(undefined).size).toBe(0);
  });
});

describe("authenticateAppClient", () => {
  it("returns none when no app headers are sent (first-party unchanged)", () => {
    expect(authenticateAppClient(headers({}), CONFIG)).toEqual({ kind: "none" });
  });
  it("accepts the right secret", () => {
    const h = headers({ "X-Skatehive-App-Id": "coletivoxv", "X-Skatehive-App-Secret": SECRET });
    expect(authenticateAppClient(h, CONFIG)).toEqual({ kind: "app", appId: "coletivoxv" });
  });
  it("rejects a wrong secret", () => {
    const h = headers({ "X-Skatehive-App-Id": "coletivoxv", "X-Skatehive-App-Secret": "nope" });
    expect(authenticateAppClient(h, CONFIG)).toEqual({ kind: "invalid" });
  });
  it("rejects an id without a secret (forged attribution)", () => {
    const h = headers({ "X-Skatehive-App-Id": "coletivoxv" });
    expect(authenticateAppClient(h, CONFIG)).toEqual({ kind: "invalid" });
  });
  it("rejects an unknown app id even with a secret", () => {
    const h = headers({ "X-Skatehive-App-Id": "other", "X-Skatehive-App-Secret": SECRET });
    expect(authenticateAppClient(h, CONFIG)).toEqual({ kind: "invalid" });
  });
  it("rejects everything when no clients are configured", () => {
    const h = headers({ "X-Skatehive-App-Id": "coletivoxv", "X-Skatehive-App-Secret": SECRET });
    expect(authenticateAppClient(h, undefined)).toEqual({ kind: "invalid" });
  });
});

describe("rateLimitIp", () => {
  const req = (h: Record<string, string>) => new Request("https://api.test/x", { headers: h });
  it("ignores the end-user header for first-party callers", () => {
    const r = req({ "x-real-ip": "1.1.1.1", "x-skatehive-end-user-ip": "9.9.9.9" });
    expect(rateLimitIp(r, { kind: "none" })).toBe("1.1.1.1");
  });
  it("uses the namespaced end-user IP for an authenticated app", () => {
    const r = req({ "x-real-ip": "1.1.1.1", "x-skatehive-end-user-ip": "9.9.9.9" });
    expect(rateLimitIp(r, { kind: "app", appId: "coletivoxv" })).toBe("coletivoxv:9.9.9.9");
  });
});

describe("signup tokens carry their app context", () => {
  it("round-trips app and defaults to null for first-party", async () => {
    process.env.USERBASE_INTERNAL_TOKEN ||= "test-secret";
    const { signSignupToken, verifySignupToken } = await import("./signupToken");
    expect(verifySignupToken(signSignupToken("a@b.co"))).toMatchObject({ email: "a@b.co", app: null });
    expect(verifySignupToken(signSignupToken("a@b.co", "coletivoxv"))).toMatchObject({ app: "coletivoxv" });
  });
});
