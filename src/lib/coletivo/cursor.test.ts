import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseLimit } from "./cursor";

const id = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";

describe("cursor", () => {
  it("round-trips (ts, id)", () => {
    const c = { ts: "2026-11-10T01:02:03.000Z", id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("absent -> null; garbage -> invalid", () => {
    expect(decodeCursor(null)).toBeNull();
    for (const bad of ["x", Buffer.from('["nope","x"]').toString("base64url"), Buffer.from('{"a":1}').toString("base64url"), "a".repeat(300)]) {
      expect(decodeCursor(bad)).toBe("invalid");
    }
  });
  it("limit bounds", () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit("0")).toBe(20);
    expect(parseLimit("-5")).toBe(20);
    expect(parseLimit("7")).toBe(7);
    expect(parseLimit("1000")).toBe(50);
  });
});
