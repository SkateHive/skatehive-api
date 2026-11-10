import { describe, expect, it } from "vitest";
import { PrivateKey, cryptoUtils } from "@hiveio/dhive";
import { buildChallengeMessage, isAllowedModeratorHandle, verifyBindingSignature } from "./moderatorBinding";

const key = PrivateKey.fromSeed("coletivo-binding-test");
const other = PrivateKey.fromSeed("someone-else");
const pub = key.createPublic().toString();
const message = buildChallengeMessage({
  app: "coletivoxv",
  userId: "user-1",
  hiveHandle: "xvlad",
  nonce: "n1",
  expiresAt: "2026-11-10T00:05:00.000Z",
});
const sign = (k: PrivateKey, m: string) => k.sign(cryptoUtils.sha256(Buffer.from(m))).toString();
const account = (keys: Array<[string, number]>, threshold = 1) => async () => ({
  posting: { weight_threshold: threshold, key_auths: keys },
});

describe("moderator binding", () => {
  it("allow-list is fixed in code", () => {
    expect(isAllowedModeratorHandle("xvlad")).toBe(true);
    expect(isAllowedModeratorHandle("XVLAD")).toBe(false);
    expect(isAllowedModeratorHandle("attacker")).toBe(false);
    // No on-chain account with that name: it must not be grantable.
    expect(isAllowedModeratorHandle("pharraxv")).toBe(false);
  });

  it("the message binds app, account, user, nonce and expiry", () => {
    for (const part of ["coletivoxv", "@xvlad", "user-1", "n1", "2026-11-10T00:05:00.000Z"]) {
      expect(message).toContain(part);
    }
  });

  it("accepts a signature by an on-chain posting key with enough weight", async () => {
    const r = await verifyBindingSignature({ message, signature: sign(key, message), hiveHandle: "xvlad", getAccount: account([[pub, 1]]) });
    expect(r).toEqual({ ok: true, publicKey: pub });
  });

  it("rejects: other key, tampered message, low weight, unknown account, bad format, chain down", async () => {
    const good = sign(key, message);
    expect(await verifyBindingSignature({ message, signature: sign(other, message), hiveHandle: "xvlad", getAccount: account([[pub, 1]]) }))
      .toMatchObject({ ok: false, code: "key_not_authorized" });
    expect(await verifyBindingSignature({ message: message.replace("user-1", "user-2"), signature: good, hiveHandle: "xvlad", getAccount: account([[pub, 1]]) }))
      .toMatchObject({ ok: false, code: "key_not_authorized" });
    expect(await verifyBindingSignature({ message, signature: good, hiveHandle: "xvlad", getAccount: account([[pub, 1]], 2) }))
      .toMatchObject({ ok: false, code: "key_not_authorized" });
    expect(await verifyBindingSignature({ message, signature: good, hiveHandle: "xvlad", getAccount: async () => null }))
      .toMatchObject({ ok: false, code: "key_not_authorized" });
    expect(await verifyBindingSignature({ message, signature: "zz", hiveHandle: "xvlad", getAccount: account([[pub, 1]]) }))
      .toMatchObject({ ok: false, status: 400, code: "invalid_signature" });
    expect(await verifyBindingSignature({ message, signature: good, hiveHandle: "xvlad", getAccount: async () => { throw new Error(); } }))
      .toMatchObject({ ok: false, status: 503, code: "chain_unavailable" });
  });
});
