import { describe, expect, it, vi } from "vitest";
import {
  boundedAll, countPositiveVotes, decodeCommentCursor, hiveDateToIso, readComments, readEngagement,
  TtlCache, verifyChainPost, MAX_DIRECT_REPLIES, type ChainReader, type PublishedTarget,
} from "./engagement";

const ID = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const SNAP: PublishedTarget = { id: ID, publish_author: "alice", publish_permlink: "coletivoxv-p1", publish_parent_author: "peak.snaps", publish_parent_permlink: "snap-container-1" };
const LEGACY: PublishedTarget = { ...SNAP, publish_author: "xvlad", publish_permlink: "coletivoxv-legacy", publish_parent_author: null, publish_parent_permlink: null };
const meta = (id = ID) => JSON.stringify({ app: "coletivoxv/1.0", coletivoxv: { submission_id: id } });
const vote = (voter: string, percent: number | string) => ({ voter, percent, weight: 1, rshares: 1, time: "2026-11-10T00:00:00" });

// Shape of a real thread (anonymized): 4 direct replies, 2 nested -> children 6.
const post = (t: PublishedTarget, over: Record<string, unknown> = {}) => ({
  author: t.publish_author, permlink: t.publish_permlink,
  parent_author: t.publish_parent_author ?? "", parent_permlink: t.publish_parent_permlink ?? "hive-173115",
  json_metadata: meta(t.id), children: 6, active_votes: [vote("a", 10000), vote("b", 5000)], ...over,
});
const reply = (t: PublishedTarget, n: number, over: Record<string, unknown> = {}) => ({
  author: `u${n}`, permlink: `re-${n}`, parent_author: t.publish_author, parent_permlink: t.publish_permlink,
  created: `2026-11-10T10:00:0${n % 10}`, body: `comment ${n}`, children: n === 1 ? 2 : 0,
  active_votes: [vote("x", 100)], net_rshares: "5", ...over,
});
const reader = (content: unknown, replies: unknown = []): ChainReader => ({
  getContent: vi.fn(async () => content), getReplies: vi.fn(async () => replies),
});

describe("countPositiveVotes", () => {
  it("counts distinct voters with percent > 0; 0 and downvotes excluded; numeric strings ok", () => {
    expect(countPositiveVotes([vote("a", 10000), vote("a", 5000), vote("b", "100"), vote("c", 0), vote("d", -10000)])).toBe(2);
    expect(countPositiveVotes([])).toBe(0);
  });
  it("malformed list is unknown (null), never 0", () => {
    expect(countPositiveVotes(null)).toBeNull();
    expect(countPositiveVotes([{ percent: 100 }])).toBeNull();
    expect(countPositiveVotes([vote("a", "abc")])).toBeNull();
    expect(countPositiveVotes([vote("a", 1.5)])).toBeNull();
    expect(countPositiveVotes([vote("a", 10001)])).toBeNull();
  });
});

describe("verifyChainPost", () => {
  it("snap: author/permlink/submission/saved parent must all match", () => {
    expect(verifyChainPost(post(SNAP), SNAP)).toBe("ok");
    expect(verifyChainPost(post(SNAP, { json_metadata: meta("other") }), SNAP)).toBe("mismatch");
    expect(verifyChainPost(post(SNAP, { parent_permlink: "snap-container-2" }), SNAP)).toBe("mismatch");
    expect(verifyChainPost(post(SNAP, { author: "mallory" }), SNAP)).toBe("mismatch");
    expect(verifyChainPost(post(SNAP, { json_metadata: "{broken" }), SNAP)).toBe("mismatch");
  });
  it("legacy blog post (no saved parent) must be the community root", () => {
    expect(verifyChainPost(post(LEGACY), LEGACY, {} as NodeJS.ProcessEnv)).toBe("ok");
    expect(verifyChainPost(post(LEGACY, { parent_author: "peak.snaps", parent_permlink: "snap-container-1" }), LEGACY, {} as NodeJS.ProcessEnv)).toBe("mismatch");
  });
});

describe("readEngagement", () => {
  it("ok: positive votes + TOTAL replies (children)", async () => {
    const e = await readEngagement(SNAP, reader(post(SNAP)), { timeoutMs: 1000, now: () => new Date("2026-11-10T00:00:00Z") });
    expect(e).toEqual({ status: "ok", votes_up: 2, comments_total: 6, updated_at: "2026-11-10T00:00:00.000Z" });
  });
  it("legacy blog works", async () => {
    expect(await readEngagement(LEGACY, reader(post(LEGACY)), { timeoutMs: 1000 })).toMatchObject({ status: "ok" });
  });
  it("chain error / timeout / mismatch / malformed -> unavailable, never zeros", async () => {
    const down: ChainReader = { getContent: async () => { throw new Error("rpc"); }, getReplies: async () => [] };
    expect(await readEngagement(SNAP, down, { timeoutMs: 1000 })).toEqual({ status: "unavailable", code: "chain_unavailable" });
    const hang: ChainReader = { getContent: () => new Promise(() => {}), getReplies: async () => [] };
    expect(await readEngagement(SNAP, hang, { timeoutMs: 20 })).toEqual({ status: "unavailable", code: "timeout" });
    expect(await readEngagement(SNAP, reader(post(SNAP, { json_metadata: meta("x") })), { timeoutMs: 1000 })).toEqual({ status: "unavailable", code: "chain_mismatch" });
    for (const bad of [{ children: -1 }, { children: 1.5 }, { children: "x" }, { active_votes: "nope" }]) {
      expect(await readEngagement(SNAP, reader(post(SNAP, bad)), { timeoutMs: 1000 })).toEqual({ status: "unavailable", code: "malformed" });
    }
  });
});

describe("boundedAll", () => {
  it("respects concurrency", async () => {
    let active = 0, peak = 0;
    const { results } = await boundedAll([1, 2, 3, 4, 5, 6], async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n * 2;
    }, { concurrency: 2, deadlineMs: 1000, onTimeout: () => -1 });
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
  it("after the deadline nothing new starts, even when a pending worker resolves later", async () => {
    const starts: number[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const out = await boundedAll([1, 2, 3, 4], async (n, signal) => {
      starts.push(n);
      if (n === 1) await slow;
      return signal.aborted ? -2 : n;
    }, { concurrency: 1, deadlineMs: 20, onTimeout: () => -1 });
    expect(out.results).toEqual([-1, -1, -1, -1]); // item 1 timed out, 2-4 never ran
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(starts).toEqual([1]);
    expect(out.started).toBe(1);
  });
});

describe("readComments (first level of the post itself)", () => {
  const replies = [reply(SNAP, 3), reply(SNAP, 1), reply(SNAP, 2), reply(SNAP, 4)];
  it("reads the post's own replies, oldest first, with totals", async () => {
    const r = reader(post(SNAP), replies);
    const p = await readComments(SNAP, r, { timeoutMs: 1000, limit: 50, cursor: null });
    expect((r.getReplies as any).mock.calls[0].slice(0, 2)).toEqual(["alice", "coletivoxv-p1"]); // never the container
    if (p.status !== "ok") throw new Error();
    expect(p).toMatchObject({ total_replies: 6, direct_count: 4, partial: false, next_cursor: null, thread_url: "https://skatehive.app/post/alice/coletivoxv-p1" });
    expect(p.items.map((c) => c.id)).toEqual(["u1/re-1", "u2/re-2", "u3/re-3", "u4/re-4"]);
    expect(p.items[0]).toMatchObject({ author: { handle: "u1", avatar_url: "https://images.hive.blog/u/u1/avatar" }, created_at: "2026-11-10T10:00:01.000Z", replies: 2, votes_up: 1, low_score: false });
  });
  it("stable cursor (created, author, permlink): equal timestamps never skip or repeat", async () => {
    const same = [1, 2, 3, 4, 5].map((n) => reply(SNAP, n, { created: "2026-11-10T10:00:00", children: 0 }));
    const r = reader(post(SNAP, { children: 5 }), same);
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCommentCursor>;
    for (let i = 0; i < 10; i++) {
      const p = await readComments(SNAP, r, { timeoutMs: 1000, limit: 2, cursor: cursor as any });
      if (p.status !== "ok") throw new Error();
      seen.push(...p.items.map((c) => c.id));
      if (!p.next_cursor) break;
      cursor = decodeCommentCursor(p.next_cursor);
    }
    expect(seen).toEqual(["u1/re-1", "u2/re-2", "u3/re-3", "u4/re-4", "u5/re-5"]);
  });
  it("a malformed or foreign reply makes the list unavailable (never silently dropped)", async () => {
    for (const bad of [reply(SNAP, 9, { created: "nope" }), reply(SNAP, 9, { children: -1 }), reply(SNAP, 9, { parent_permlink: "other" }), { foo: 1 }]) {
      const p = await readComments(SNAP, reader(post(SNAP), [...replies, bad]), { timeoutMs: 1000, limit: 50, cursor: null });
      expect(p).toEqual({ status: "unavailable", code: "malformed" });
    }
  });
  it("more direct replies than the subtree total is impossible -> malformed", async () => {
    expect(await readComments(SNAP, reader(post(SNAP, { children: 2 }), replies), { timeoutMs: 1000, limit: 50, cursor: null })).toEqual({ status: "unavailable", code: "malformed" });
  });
  it("over the processing cap: partial=true with thread_url (truncation is never hidden)", async () => {
    const many = Array.from({ length: MAX_DIRECT_REPLIES + 1 }, (_, n) => reply(SNAP, n, { children: 0, created: "2026-11-10T10:00:00" }));
    const p = await readComments(SNAP, reader(post(SNAP, { children: many.length }), many), { timeoutMs: 1000, limit: 50, cursor: null });
    if (p.status !== "ok") throw new Error(JSON.stringify(p));
    expect(p).toMatchObject({ partial: true, direct_count: MAX_DIRECT_REPLIES + 1 });
  });
  it("chain failure -> unavailable, never an empty list", async () => {
    const down: ChainReader = { getContent: async () => post(SNAP), getReplies: async () => { throw new Error("rpc"); } };
    expect(await readComments(SNAP, down, { timeoutMs: 1000, limit: 50, cursor: null })).toEqual({ status: "unavailable", code: "chain_unavailable" });
  });
  it("long bodies are capped and flagged; downvoted replies flagged low_score", async () => {
    const p = await readComments(SNAP, reader(post(SNAP), [reply(SNAP, 1, { body: "x".repeat(12000), net_rshares: -3, children: 0 })]), { timeoutMs: 1000, limit: 50, cursor: null });
    if (p.status !== "ok") throw new Error();
    expect(p.items[0]).toMatchObject({ body_truncated: true, low_score: true });
    expect(p.items[0].body.length).toBe(10000);
  });
  it("cursor decoding rejects garbage", () => {
    expect(decodeCommentCursor("@@@")).toBe("invalid");
    expect(decodeCommentCursor(Buffer.from('["a"]').toString("base64url"))).toBe("invalid");
    expect(decodeCommentCursor(null)).toBeNull();
  });
});

describe("hiveDateToIso / TtlCache", () => {
  it("Hive dates are UTC without a zone", () => {
    expect(hiveDateToIso("2026-11-10T19:00:00")).toBe("2026-11-10T19:00:00.000Z");
    expect(hiveDateToIso("2026-11-10")).toBeNull();
  });
  it("cache is also bounded by total bytes; oversized values are not cached", () => {
    const c = new TtlCache<string>(10, 1000, () => 0, { maxBytes: 10, sizeOf: (v) => v.length });
    c.set("a", "xxxx"); c.set("b", "xxxx"); c.set("c", "xxxx"); // 12 bytes > 10 -> evict oldest
    expect(c.get("a")).toBeUndefined();
    expect(c.totalBytes).toBe(8);
    c.set("big", "x".repeat(11));
    expect(c.get("big")).toBeUndefined();
    expect(c.totalBytes).toBe(8);
    c.clear();
    expect(c.totalBytes).toBe(0);
  });
  it("cache is bounded and expires", () => {
    let t = 0;
    const c = new TtlCache<number>(2, 100, () => t);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.size).toBe(2);
    expect(c.get("a")).toBeUndefined();
    t = 200;
    expect(c.get("c")).toBeUndefined();
  });
});
