import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/userbase/appClient";
import { StoreError } from "@/lib/coletivo/store";

const SECRET = "coletivo-test-secret";
const TOKEN = "a".repeat(64);
const ID = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const store = vi.hoisted(() => ({ me: vi.fn(), createPost: vi.fn(), getPublicPost: vi.fn() }));
vi.mock("@/lib/coletivo/store", async (orig) => ({ ...(await orig<typeof import("@/lib/coletivo/store")>()), ...store }));
vi.mock("@/lib/coletivo/service", () => ({ runPublishFlow: vi.fn(async () => ({ status: "busy" })) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));

const app = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": SECRET };
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, status: "published", publication_type: "article", kind: "photo", title: "Arte do Corre", body: "texto",
  media: [{ type: "image", url: "https://images.hive.blog/cover.jpg" }, { type: "image", url: "https://images.hive.blog/2.jpg" }],
  context_kind: "evento", context_slug: "arte-do-corre", created_at: "t", reviewed_at: "t", reject_reason: null,
  published_at: "2026-11-10T21:00:00Z", publish_author: "xvlad", publish_permlink: "coletivoxv-x", last_error_code: null,
  author_handle: "xvlad", author_display_name: null, author_avatar_url: null, ...over,
});

beforeEach(() => vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)}`));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("POST /submissions publication_type", () => {
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import("./submissions/route");
    return POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "idempotency-key": "k".repeat(16), ...app } }));
  };
  it("OLD payload (no field) -> snap sent to the DB", async () => {
    store.me.mockResolvedValueOnce({ user_id: "u" });
    store.createPost.mockResolvedValueOnce(row({ status: "pending", publication_type: "snap" }));
    expect((await post({ consent_publish: true, body: "oi" })).status).toBe(201);
    expect(store.createPost.mock.calls[0][1]).toMatchObject({ publicationType: "snap" });
  });
  it("article -> sent as article; title required", async () => {
    store.me.mockResolvedValue({ user_id: "u" });
    expect((await (await post({ consent_publish: true, publication_type: "article", body: "x" })).json()).code).toBe("title_required");
    store.createPost.mockResolvedValueOnce(row({ status: "pending" }));
    const res = await post({ consent_publish: true, publication_type: "article", title: "T", body: "x" });
    expect(res.status).toBe(201);
    expect(store.createPost.mock.calls[0][1]).toMatchObject({ publicationType: "article", title: "T" });
    expect((await res.json()).submission).toMatchObject({ publication_type: "article", cover: "https://images.hive.blog/cover.jpg" });
  });
});

describe("GET /posts/:id (public detail)", () => {
  const get = async (id: string, headers: Record<string, string> = app) => {
    const { GET } = await import("./posts/[id]/route");
    return GET(new NextRequest(`http://localhost/posts/${id}`, { headers }), { params: Promise.resolve({ id }) });
  };
  it("published: public fields + publication_type + cover = first photo; app credential required, no session", async () => {
    store.getPublicPost.mockResolvedValueOnce(row());
    const res = await get(ID);
    expect(res.status).toBe(200);
    const { post } = await res.json();
    expect(post).toMatchObject({ id: ID, publication_type: "article", title: "Arte do Corre", body: "texto", cover: "https://images.hive.blog/cover.jpg", hive: { url: "https://skatehive.app/post/xvlad/coletivoxv-x" } });
    expect(post).not.toHaveProperty("reject_reason");
    expect(post).not.toHaveProperty("last_error_code");
    expect(store.getPublicPost).toHaveBeenCalledWith(ID);
    expect((await get(ID, {})).status).toBe(403);
  });
  it("not published / unknown -> 404 without destination; DB failure -> 503; bad id -> 404", async () => {
    store.getPublicPost.mockRejectedValueOnce(new StoreError(404, "not_found"));
    const res = await get(ID);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/xvlad|coletivoxv-/);
    store.getPublicPost.mockRejectedValueOnce(new StoreError(503, "unavailable"));
    expect((await get(ID)).status).toBe(503);
    expect((await get("nope")).status).toBe(404);
  });
  it("legacy blog classified article by the migration is served as article", async () => {
    store.getPublicPost.mockResolvedValueOnce(row({ publication_type: "article" }));
    expect((await (await get(ID)).json()).post.publication_type).toBe("article");
  });
  it("older DB rows without the column default to snap", async () => {
    const r = row(); delete (r as any).publication_type;
    store.getPublicPost.mockResolvedValueOnce(r);
    expect((await (await get(ID)).json()).post.publication_type).toBe("snap");
  });
});
