import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/userbase/appClient";
import { StoreError } from "@/lib/coletivo/store";

const SECRET = "coletivo-test-secret";
const A = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const B = "6f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const svc = vi.hoisted(() => ({
  publishedTargets: vi.fn(),
  chainReader: { getContent: vi.fn(), getReplies: vi.fn() },
}));
vi.mock("@/lib/coletivo/engagementService", async () => {
  const { TtlCache } = await import("@/lib/coletivo/engagement");
  return { ...svc, engagementCache: new TtlCache(500, 30_000), commentsCache: new TtlCache(100, 30_000) };
});

const target = (id: string, author = "alice") => ({ id, publish_author: author, publish_permlink: `coletivoxv-${id.slice(0, 4)}`, publish_parent_author: "peak.snaps", publish_parent_permlink: "snap-container-1" });
const content = (t: ReturnType<typeof target>, extra: Record<string, unknown> = {}) => ({
  author: t.publish_author, permlink: t.publish_permlink, parent_author: "peak.snaps", parent_permlink: "snap-container-1",
  json_metadata: JSON.stringify({ coletivoxv: { submission_id: t.id } }), children: 3, active_votes: [{ voter: "v", percent: 100 }], ...extra,
});
const req = (path: string, headers: Record<string, string> = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": SECRET }) =>
  new NextRequest(`http://localhost/api/userbase/apps/coletivoxv/community${path}`, { headers });

beforeEach(async () => {
  vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`);
  const m = await import("@/lib/coletivo/engagementService");
  m.engagementCache.clear();
  m.commentsCache.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.resetModules(); });

describe("GET /engagement", () => {
  it("requires the app credential", async () => {
    const { GET } = await import("./engagement/route");
    expect((await GET(req(`/engagement?ids=${A}`, {}))).status).toBe(403);
    expect(svc.publishedTargets).not.toHaveBeenCalled();
  });
  it("validates ids (uuid, 1..24)", async () => {
    const { GET } = await import("./engagement/route");
    expect((await GET(req("/engagement?ids=nope"))).status).toBe(400);
    const many = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(8, "0")}-1b2c-4d3e-8f90-123456789abc`).join(",");
    expect((await GET(req(`/engagement?ids=${many}`))).status).toBe(400);
  });
  it("DB failure -> 503 (never looks like not found)", async () => {
    svc.publishedTargets.mockRejectedValueOnce(new StoreError(503, "unavailable"));
    const { GET } = await import("./engagement/route");
    expect((await GET(req(`/engagement?ids=${A}`))).status).toBe(503);
  });
  it("unknown/unpublished ids are absent; chain failures listed as unavailable, never 0; private cache", async () => {
    const tA = target(A), tB = target(B, "bob");
    svc.publishedTargets.mockResolvedValueOnce(new Map([[A, tA], [B, tB]]));
    svc.chainReader.getContent.mockImplementation(async (a: string) => (a === "alice" ? content(tA) : Promise.reject(new Error("rpc"))));
    const { GET } = await import("./engagement/route");
    const unknown = "7f0c2a7e-1b2c-4d3e-8f90-123456789abc";
    const res = await GET(req(`/engagement?ids=${A},${B},${unknown}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=15");
    const j = await res.json();
    expect(j.items[A]).toMatchObject({ votes_up: 1, comments_total: 3 });
    expect(j.items).not.toHaveProperty(B);
    expect(j.items).not.toHaveProperty(unknown);
    expect(j.unavailable).toEqual([B]);
  });
  it("all chain reads failed -> 503 chain_unavailable", async () => {
    svc.publishedTargets.mockResolvedValueOnce(new Map([[A, target(A)]]));
    svc.chainReader.getContent.mockRejectedValue(new Error("rpc"));
    const { GET } = await import("./engagement/route");
    const res = await GET(req(`/engagement?ids=${A}`));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("chain_unavailable");
  });
  it("second request within TTL is served from cache (one chain read)", async () => {
    const tA = target(A);
    svc.publishedTargets.mockResolvedValue(new Map([[A, tA]]));
    svc.chainReader.getContent.mockResolvedValue(content(tA));
    const { GET } = await import("./engagement/route");
    await GET(req(`/engagement?ids=${A}`));
    await GET(req(`/engagement?ids=${A}`));
    expect(svc.chainReader.getContent).toHaveBeenCalledTimes(1);
  });
});

describe("GET /submissions/:id/comments", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  it("unknown/unpublished -> 404 not_published with no destination; no chain call", async () => {
    svc.publishedTargets.mockResolvedValueOnce(new Map());
    const { GET } = await import("./submissions/[id]/comments/route");
    const res = await GET(req(`/submissions/${A}/comments`), params(A));
    expect(res.status).toBe(404);
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/alice|coletivoxv-/);
    expect(svc.chainReader.getContent).not.toHaveBeenCalled();
  });
  it("DB failure -> 503, not 404", async () => {
    svc.publishedTargets.mockRejectedValueOnce(new StoreError(503, "unavailable"));
    const { GET } = await import("./submissions/[id]/comments/route");
    expect((await GET(req(`/submissions/${A}/comments`), params(A))).status).toBe(503);
  });
  it("chain failure -> 503, never an empty list", async () => {
    svc.publishedTargets.mockResolvedValueOnce(new Map([[A, target(A)]]));
    svc.chainReader.getContent.mockRejectedValueOnce(new Error("rpc"));
    svc.chainReader.getReplies.mockResolvedValueOnce([]);
    const { GET } = await import("./submissions/[id]/comments/route");
    const res = await GET(req(`/submissions/${A}/comments`), params(A));
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("items");
  });
  it("ok: first-level replies of the post itself", async () => {
    const tA = target(A);
    svc.publishedTargets.mockResolvedValueOnce(new Map([[A, tA]]));
    svc.chainReader.getContent.mockResolvedValueOnce(content(tA, { children: 1 }));
    svc.chainReader.getReplies.mockResolvedValueOnce([{ author: "u1", permlink: "re-1", parent_author: tA.publish_author, parent_permlink: tA.publish_permlink, created: "2026-11-10T10:00:00", body: "boa", children: 0, active_votes: [], net_rshares: 0 }]);
    const { GET } = await import("./submissions/[id]/comments/route");
    const res = await GET(req(`/submissions/${A}/comments?limit=5`), params(A));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ success: true, total_replies: 1, direct_count: 1, partial: false, next_cursor: null });
    expect(svc.chainReader.getReplies.mock.calls[0].slice(0, 2)).toEqual([tA.publish_author, tA.publish_permlink]);
    expect(svc.chainReader.getReplies.mock.calls[0][2]).toBeInstanceOf(AbortSignal); // budget reaches the fetch
  });
  it("bad cursor -> 400", async () => {
    const { GET } = await import("./submissions/[id]/comments/route");
    expect((await GET(req(`/submissions/${A}/comments?cursor=@@`), params(A))).status).toBe(400);
  });
});
