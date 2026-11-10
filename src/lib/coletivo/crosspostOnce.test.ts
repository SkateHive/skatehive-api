import { describe, expect, it, vi } from "vitest";
import { enqueueCrosspostOnce } from "./crosspostOnce";

const item = { publish_author: "skateuser", publish_permlink: "coletivoxv-p1" };

describe("enqueueCrosspostOnce", () => {
  it("first time: enqueues", async () => {
    const enqueue = vi.fn(async () => "q1");
    expect(await enqueueCrosspostOnce(item, { findAny: async () => null, enqueue })).toEqual({ id: "q1", reused: false });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it.each(["pending_review", "approved", "published", "rejected", "failed"])(
    "replay after crash with an existing %s row: reuses it, never reopens",
    async (status) => {
      const enqueue = vi.fn(async () => "new");
      const findAny = vi.fn(async () => ({ id: "q1", status }));
      expect(await enqueueCrosspostOnce(item, { findAny, enqueue })).toEqual({ id: "q1", reused: true });
      expect(findAny).toHaveBeenCalledWith("instagram", "skateuser", "coletivoxv-p1");
      expect(enqueue).not.toHaveBeenCalled();
    }
  );

  it("lookup failure propagates (outbox retries later) instead of enqueueing blind", async () => {
    const enqueue = vi.fn(async () => "q1");
    await expect(enqueueCrosspostOnce(item, { findAny: async () => { throw new Error("db"); }, enqueue })).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
