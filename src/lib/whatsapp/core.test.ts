import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/userbase/appClient";
import {
  cleanSnapBody,
  codeHash,
  generateLinkCode,
  isWhatsappBot,
  normalizeLinkCode,
  normalizePhone,
  phoneHash,
  SNAP_MAX_CHARS,
  snapMetadata,
  snapPermlink,
} from "./core";

const SECRET = "wa-test-secret";
const CONFIG = `whatsapp:${sha256Hex(SECRET)},coletivoxv:${sha256Hex("other")}`;
const PEPPER = "p".repeat(64);

describe("isWhatsappBot", () => {
  it("accepts the whatsapp app with its secret", () => {
    const h = new Headers({ "x-skatehive-app-id": "whatsapp", "x-skatehive-app-secret": SECRET });
    expect(isWhatsappBot(h, CONFIG)).toBe(true);
  });
  it("rejects another valid app", () => {
    const h = new Headers({ "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": "other" });
    expect(isWhatsappBot(h, CONFIG)).toBe(false);
  });
  it("rejects a wrong secret and missing headers", () => {
    expect(isWhatsappBot(new Headers({ "x-skatehive-app-id": "whatsapp", "x-skatehive-app-secret": "x" }), CONFIG)).toBe(false);
    expect(isWhatsappBot(new Headers(), CONFIG)).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("reads E.164, digits and JIDs to the same digits", () => {
    expect(normalizePhone("+55 21 99999-0000")).toBe("5521999990000");
    expect(normalizePhone("5521999990000@s.whatsapp.net")).toBe("5521999990000");
    expect(normalizePhone("5521999990000:12@s.whatsapp.net")).toBe("5521999990000");
  });
  it("rejects junk, letters, groups and bad lengths", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("1".repeat(16))).toBeNull();
    expect(normalizePhone("@lid")).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
  it("accepts only phone JID namespaces", () => {
    expect(normalizePhone("5521999990000@c.us")).toBe("5521999990000");
    expect(normalizePhone("5521999990000@lid")).toBeNull();
    expect(normalizePhone("5521999990000@g.us")).toBeNull();
    expect(normalizePhone("120363000000000000@g.us")).toBeNull();
    expect(normalizePhone("5521999990000@broadcast")).toBeNull();
    expect(normalizePhone("5521999990000@newsletter")).toBeNull();
    expect(normalizePhone("5521999990000:abc@s.whatsapp.net")).toBeNull();
    expect(normalizePhone("5521999990000:1234@s.whatsapp.net")).toBeNull();
    expect(normalizePhone("55-21@s.whatsapp.net")).toBeNull();
  });
});

describe("phoneHash", () => {
  it("is stable, hex, and depends on the pepper", () => {
    const a = phoneHash("5521999990000", PEPPER);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash("5521999990000", PEPPER)).toBe(a);
    expect(phoneHash("5521999990000", "q".repeat(64))).not.toBe(a);
  });
  it("refuses to run without a real pepper", () => {
    expect(() => phoneHash("5521999990000", "")).toThrow();
    expect(() => phoneHash("5521999990000", "short")).toThrow();
  });
});

describe("link codes", () => {
  it("generates codes that normalize to themselves", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateLinkCode();
      expect(c).toMatch(/^SK-[2-9A-HJKMNP-Z]{8}$/);
      expect(normalizeLinkCode(c)).toBe(c);
    }
  });
  it("accepts what people actually type", () => {
    expect(normalizeLinkCode("sk-abcd2345")).toBe("SK-ABCD2345");
    expect(normalizeLinkCode(" SK ABCD 2345 ")).toBe("SK-ABCD2345");
    expect(normalizeLinkCode("ABCD2345")).toBe("SK-ABCD2345");
  });
  it("keeps code bodies that start with SK", () => {
    expect(normalizeLinkCode("SKAB2345")).toBe("SK-SKAB2345");
    expect(normalizeLinkCode("SK-SKAB2345")).toBe("SK-SKAB2345");
    expect(normalizeLinkCode("skskab2345")).toBe("SK-SKAB2345");
  });
  it("rejects ambiguous characters and wrong lengths", () => {
    expect(normalizeLinkCode("SK-ABCD0345")).toBeNull();
    expect(normalizeLinkCode("SK-ABC")).toBeNull();
    expect(normalizeLinkCode(null)).toBeNull();
  });
  it("hashes codes", () => {
    expect(codeHash("SK-ABCD2345")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snaps", () => {
  it("cleans the body", () => {
    expect(cleanSnapBody("  kickflip na praça \r\n ")).toBe("kickflip na praça");
    expect(cleanSnapBody("   ")).toBeNull();
    expect(cleanSnapBody("x".repeat(SNAP_MAX_CHARS + 1))).toBeNull();
  });
  it("builds a unique wa- permlink", () => {
    const p = snapPermlink(1_700_000_000_000);
    expect(p).toMatch(/^wa-[a-z0-9]+-[0-9a-f]{6}$/);
    expect(snapPermlink(1)).not.toBe(snapPermlink(1));
  });
  it("tags metadata and embeds the safe user only when present", () => {
    expect(snapMetadata(null)).toEqual({ app: "skatehive-whatsapp", tags: ["snaps", "hive-173115", "skatehive", "skate"] });
    expect(snapMetadata("abc").skatehive_user).toBe("abc");
  });
});
