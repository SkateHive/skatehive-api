import { afterEach, describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/app/utils/hive/hiveUtils", () => ({ HiveClient: { database: { call } } }));
vi.mock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: null }));

describe("resolveSnapContainer (same lookup as the web/mobile composers)", () => {
  afterEach(() => call.mockReset());

  it("returns the latest ROOT snap-container of peak.snaps", async () => {
    call.mockResolvedValueOnce([{ author: "peak.snaps", permlink: "snap-container-1794317040", parent_author: "" }]);
    const { resolveSnapContainer } = await import("./service");
    expect(await resolveSnapContainer()).toEqual({ parentAuthor: "peak.snaps", parentPermlink: "snap-container-1794317040" });
    const [method, params] = call.mock.calls[0];
    expect(method).toBe("get_discussions_by_author_before_date");
    expect(params.slice(0, 2)).toEqual(["peak.snaps", ""]);
    expect(params[3]).toBe(1);
  });

  it.each([
    [[]],
    [null],
    [[{ author: "peak.snaps", permlink: "re-something", parent_author: "someone" }]], // a reply by peak.snaps
    [[{ author: "peak.snaps", permlink: "snap-container-1", parent_author: "x" }]],   // not a root post
    [[{ author: "peak.snaps", permlink: "weekly-update", parent_author: "" }]],      // root but not a container
    [[{ author: "other", permlink: "snap-container-1", parent_author: "" }]],
  ])("fails closed on %j", async (rows) => {
    call.mockResolvedValueOnce(rows);
    const { resolveSnapContainer } = await import("./service");
    await expect(resolveSnapContainer()).rejects.toThrow("snap_container_unavailable");
  });

  it("propagates RPC errors (publisher turns them into retryable, zero broadcast)", async () => {
    call.mockRejectedValueOnce(new Error("rpc down"));
    const { resolveSnapContainer } = await import("./service");
    await expect(resolveSnapContainer()).rejects.toThrow();
  });
});
