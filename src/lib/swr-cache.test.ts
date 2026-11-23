import { describe, expect, it, vi } from "vitest";
import { SwrCache } from "./swr-cache";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("SwrCache", () => {
  it("runs the loader once and serves hits while fresh", async () => {
    const c = clock();
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000, now: c.now });
    const loader = vi.fn(async () => "v1");

    expect(await cache.get("k", loader)).toEqual({ value: "v1", state: "miss" });
    c.advance(999);
    expect(await cache.get("k", loader)).toEqual({ value: "v1", state: "hit" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent misses (a client retry joins the running load)", async () => {
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000 });
    const d = deferred<string>();
    const loader = vi.fn(() => d.promise);

    const first = cache.get("k", loader);
    const retry1 = cache.get("k", loader);
    const retry2 = cache.get("k", loader);
    d.resolve("v1");

    expect(await first).toEqual({ value: "v1", state: "miss" });
    expect(await retry1).toEqual({ value: "v1", state: "coalesced" });
    expect(await retry2).toEqual({ value: "v1", state: "coalesced" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves stale immediately and refreshes once in the background", async () => {
    const c = clock();
    const scheduled: Array<() => Promise<void>> = [];
    const cache = new SwrCache<string>({
      freshMs: 1000, staleMs: 5000, now: c.now, schedule: (t) => scheduled.push(t),
    });
    await cache.get("k", async () => "v1");
    c.advance(2000);

    const loader = vi.fn(async () => "v2");
    expect(await cache.get("k", loader)).toEqual({ value: "v1", state: "stale" });
    expect(loader).not.toHaveBeenCalled(); // not blocking the response
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cache.get("k", loader)).toEqual({ value: "v2", state: "hit" });
  });

  it("does not schedule a second refresh while one is in flight", async () => {
    const c = clock();
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000, now: c.now });
    await cache.get("k", async () => "v1");
    c.advance(2000);
    const d = deferred<string>();
    const loader = vi.fn(() => d.promise);

    await cache.get("k", loader);
    await cache.get("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    d.resolve("v2");
  });

  it("blocks on a fresh load once the entry is older than staleMs", async () => {
    const c = clock();
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000, now: c.now });
    await cache.get("k", async () => "v1");
    c.advance(5000);
    expect(await cache.get("k", async () => "v2")).toEqual({ value: "v2", state: "miss" });
  });

  it("does not cache failures, and lets the next call retry", async () => {
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000 });
    await expect(cache.get("k", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    expect(await cache.get("k", async () => "v1")).toEqual({ value: "v1", state: "miss" });
  });

  it("keeps the last good value when a background refresh fails", async () => {
    const c = clock();
    const scheduled: Array<() => Promise<void>> = [];
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000, now: c.now, schedule: (t) => scheduled.push(t) });
    await cache.get("k", async () => "v1");
    c.advance(2000);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cache.get("k", async () => { throw new Error("db down"); });
    await scheduled[0]();
    expect((await cache.get("k", async () => "unused")).value).toBe("v1");
    errSpy.mockRestore();
  });

  it("evicts the oldest entries past maxEntries", async () => {
    const c = clock();
    const cache = new SwrCache<string>({ freshMs: 1000, staleMs: 5000, now: c.now, maxEntries: 2 });
    await cache.get("a", async () => "a");
    c.advance(1);
    await cache.get("b", async () => "b");
    c.advance(1);
    await cache.get("c", async () => "c");
    const loader = vi.fn(async () => "a2");
    expect(await cache.get("a", loader)).toEqual({ value: "a2", state: "miss" });
  });
});
