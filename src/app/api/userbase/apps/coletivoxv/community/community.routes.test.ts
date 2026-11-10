import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrivateKey, cryptoUtils } from "@hiveio/dhive";
import { sha256Hex } from "@/lib/userbase/appClient";
import { StoreError } from "@/lib/coletivo/store";

const SECRET = "coletivo-test-secret";
const TOKEN = "a".repeat(64);
const TOKEN_HASH = sha256Hex(TOKEN);
const POST_ID = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const CID_URL = "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44);

const store = vi.hoisted(() => ({
  me: vi.fn(), createChallenge: vi.fn(), getChallenge: vi.fn(), bindModerator: vi.fn(),
  createPost: vi.fn(), reviewPost: vi.fn(), getPost: vi.fn(), listMine: vi.fn(),
  listQueue: vi.fn(), listFeed: vi.fn(), requeuePublish: vi.fn(),
}));
const service = vi.hoisted(() => ({
  runPublishFlow: vi.fn(async () => ({ status: "published" })),
  resumeColetivo: vi.fn(async () => ({ published: 0, retryable: 0, failed: 0, disabled: true, followups: null })),
}));
const afterSpy = vi.hoisted(() => vi.fn((fn: () => unknown) => { void fn(); }));
const chain = vi.hoisted(() => ({ getAccounts: vi.fn() }));
const media = vi.hoisted(() => ({ checkVideoUrl: vi.fn(async () => ({ ok: true })) }));

vi.mock("@/lib/coletivo/store", async (orig) => ({ ...(await orig<typeof import("@/lib/coletivo/store")>()), ...store }));
vi.mock("@/lib/coletivo/service", () => service);
vi.mock("@/lib/coletivo/mediaCheck", () => media);
vi.mock("@/app/utils/hive/hiveUtils", () => ({ HiveClient: { database: chain } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: afterSpy }));

const appHeaders = { "x-skatehive-app-id": "coletivoxv", "x-skatehive-app-secret": SECRET };
function req(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...appHeaders, ...(opts.headers || {}) };
  if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? TOKEN}`;
  return new NextRequest(`http://localhost/api/userbase/apps/coletivoxv/community${path}`, {
    method: opts.method || "GET",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers,
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const row = (over: Record<string, unknown> = {}) => ({
  id: POST_ID, status: "pending", kind: "text", title: null, body: "oi", media: [], context_kind: null, context_slug: null,
  created_at: "2026-11-10T00:00:00.000Z", reviewed_at: null, reject_reason: null, published_at: null,
  publish_author: null, publish_permlink: "coletivoxv-x", last_error_code: null, ...over,
});

beforeEach(() => vi.stubEnv("USERBASE_APP_CLIENTS", `coletivoxv:${sha256Hex(SECRET)},otherapp:${sha256Hex("other")}`));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("auth guards (every route)", () => {
  it("no app headers -> 401; another valid app -> 403; wrong secret -> 401", async () => {
    const { GET } = await import("./me/route");
    const noApp = new NextRequest("http://localhost/x", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect((await GET(noApp)).status).toBe(403); // first-party (no app) is not this app
    expect((await GET(req("/me", { headers: { "x-skatehive-app-id": "otherapp", "x-skatehive-app-secret": "other" } }))).status).toBe(403);
    expect((await GET(req("/me", { headers: { "x-skatehive-app-secret": "nope" } }))).status).toBe(401);
    expect(store.me).not.toHaveBeenCalled();
  });

  it("missing or non-app (first-party uuid) bearer -> 401 without touching the DB", async () => {
    const { GET } = await import("./me/route");
    expect((await GET(req("/me", { auth: null }))).status).toBe(401);
    expect((await GET(req("/me", { auth: "0b9e3c1e-8f2a-4c1e-9d1a-1234567890ab" }))).status).toBe(401);
    expect(store.me).not.toHaveBeenCalled();
  });

  it("only the token HASH reaches the store; DB errors map to codes, no messages leak", async () => {
    const { GET } = await import("./me/route");
    store.me.mockRejectedValueOnce(new StoreError(401, "unauthorized"));
    const res = await GET(req("/me"));
    expect(res.status).toBe(401);
    expect(store.me).toHaveBeenCalledWith(TOKEN_HASH);
    store.me.mockRejectedValueOnce(new Error("raw db message with secrets"));
    const res2 = await GET(req("/me"));
    expect(res2.status).toBe(503);
    expect(JSON.stringify(await res2.json())).not.toContain("secrets");
  });
});

describe("submissions", () => {
  const body = { consent_publish: true, body: "manobra", status: "published", author: "xvlad" };

  it("requires an Idempotency-Key and consent", async () => {
    const { POST } = await import("./submissions/route");
    expect((await POST(req("/submissions", { method: "POST", body }))).status).toBe(400);
    const r = await POST(req("/submissions", { method: "POST", body: { body: "x" }, headers: { "idempotency-key": "k".repeat(16) } }));
    expect((await r.json()).code).toBe("consent_required");
    expect(store.createPost).not.toHaveBeenCalled();
  });

  it("client status/author are ignored; pending posts do not start publishing", async () => {
    const { POST } = await import("./submissions/route");
    store.createPost.mockResolvedValueOnce(row());
    const res = await POST(req("/submissions", { method: "POST", body, headers: { "idempotency-key": "k".repeat(16) } }));
    expect(res.status).toBe(201);
    const [hash, args] = store.createPost.mock.calls[0];
    expect(hash).toBe(TOKEN_HASH);
    expect(args).not.toHaveProperty("status");
    expect(args).not.toHaveProperty("author");
    expect(service.runPublishFlow).not.toHaveBeenCalled();
  });

  it("moderator auto-approve (status approved from the DB) starts publishing after the response", async () => {
    const { POST } = await import("./submissions/route");
    store.createPost.mockResolvedValueOnce(row({ status: "approved", auto_approved: true }));
    await POST(req("/submissions", { method: "POST", body, headers: { "idempotency-key": "k".repeat(16) } }));
    expect(afterSpy).toHaveBeenCalledTimes(1);
    expect(service.runPublishFlow).toHaveBeenCalledWith(POST_ID);
  });

  it("idempotency key reused with another body -> 409 from the DB", async () => {
    const { POST } = await import("./submissions/route");
    store.createPost.mockRejectedValueOnce(new StoreError(409, "conflict"));
    expect((await POST(req("/submissions", { method: "POST", body, headers: { "idempotency-key": "k".repeat(16) } }))).status).toBe(409);
  });

  it("a forged/dead session never triggers an outbound media probe", async () => {
    const { POST } = await import("./submissions/route");
    store.me.mockRejectedValueOnce(new StoreError(401, "unauthorized"));
    const res = await POST(req("/submissions", { method: "POST", body: { consent_publish: true, media: [{ type: "video", url: CID_URL }] }, headers: { "idempotency-key": "k".repeat(16) } }));
    expect(res.status).toBe(401);
    expect(media.checkVideoUrl).not.toHaveBeenCalled();
    expect(store.createPost).not.toHaveBeenCalled();
  });

  it("an unreachable/redirecting video is refused before the DB", async () => {
    store.me.mockResolvedValueOnce({ user_id: "u", moderator_handle: null });
    const { POST } = await import("./submissions/route");
    media.checkVideoUrl.mockResolvedValueOnce({ ok: false, code: "media_redirect" } as never);
    const res = await POST(req("/submissions", { method: "POST", body: { consent_publish: true, media: [{ type: "video", url: CID_URL }] }, headers: { "idempotency-key": "k".repeat(16) } }));
    expect(res.status).toBe(422);
    expect(store.createPost).not.toHaveBeenCalled();
  });
});

describe("moderation", () => {
  it("challenge only for allow-listed handles (pharraxv refused)", async () => {
    const { POST } = await import("./moderator/challenge/route");
    expect((await POST(req("/moderator/challenge", { method: "POST", body: { hive_handle: "pharraxv" } }))).status).toBe(403);
    expect((await POST(req("/moderator/challenge", { method: "POST", body: { hive_handle: "attacker" } }))).status).toBe(403);
    store.createChallenge.mockResolvedValueOnce({ challenge_id: POST_ID, message: "m", expires_at: "t" });
    expect((await POST(req("/moderator/challenge", { method: "POST", body: { hive_handle: "XVLAD" } }))).status).toBe(200);
    expect(store.createChallenge).toHaveBeenCalledWith(TOKEN_HASH, "xvlad");
  });

  it("verify binds only with a valid on-chain signature; the recovered key is what gets stored", async () => {
    const { POST } = await import("./moderator/verify/route");
    const key = PrivateKey.fromSeed("mod-route-test");
    const pub = key.createPublic().toString();
    const message = "moderator-binding\napp: coletivoxv\naccount: xvlad\nuser: u\nnonce: n\nexpires: t";
    store.getChallenge.mockResolvedValue({ challenge_id: POST_ID, hive_handle: "xvlad", message, expires_at: "t" });
    chain.getAccounts.mockResolvedValue([{ posting: { weight_threshold: 1, key_auths: [[pub, 1]] } }]);
    store.bindModerator.mockResolvedValueOnce({ hive_handle: "xvlad" });
    const good = key.sign(cryptoUtils.sha256(Buffer.from(message))).toString();
    const ok = await POST(req("/moderator/verify", { method: "POST", body: { challenge_id: POST_ID, signature: good } }));
    expect(ok.status).toBe(200);
    expect(store.bindModerator).toHaveBeenCalledWith(TOKEN_HASH, POST_ID, pub);

    const bad = PrivateKey.fromSeed("not-xvlad").sign(cryptoUtils.sha256(Buffer.from(message))).toString();
    const no = await POST(req("/moderator/verify", { method: "POST", body: { challenge_id: POST_ID, signature: bad } }));
    expect(no.status).toBe(403);
    expect(store.bindModerator).toHaveBeenCalledTimes(1);
  });

  it("expired/used challenge -> 410, no chain call", async () => {
    const { POST } = await import("./moderator/verify/route");
    store.getChallenge.mockRejectedValueOnce(new StoreError(410, "challenge_expired_or_used"));
    const res = await POST(req("/moderator/verify", { method: "POST", body: { challenge_id: POST_ID, signature: "ab".repeat(65) } }));
    expect(res.status).toBe(410);
    expect(chain.getAccounts).not.toHaveBeenCalled();
  });

  it("approve: DB decides moderator; success kicks publishing; non-moderator 403 does not", async () => {
    const { POST } = await import("./submissions/[id]/approve/route");
    store.reviewPost.mockRejectedValueOnce(new StoreError(403, "forbidden"));
    expect((await POST(req(`/submissions/${POST_ID}/approve`, { method: "POST", body: {} }), params(POST_ID))).status).toBe(403);
    expect(service.runPublishFlow).not.toHaveBeenCalled();
    store.reviewPost.mockResolvedValueOnce(row({ status: "approved" }));
    expect((await POST(req(`/submissions/${POST_ID}/approve`, { method: "POST", body: {} }), params(POST_ID))).status).toBe(200);
    expect(service.runPublishFlow).toHaveBeenCalledWith(POST_ID);
  });

  it("reject needs a reason", async () => {
    const { POST } = await import("./submissions/[id]/reject/route");
    expect((await POST(req(`/submissions/${POST_ID}/reject`, { method: "POST", body: {} }), params(POST_ID))).status).toBe(400);
    store.reviewPost.mockResolvedValueOnce(row({ status: "rejected", reject_reason: "fora do tema" }));
    expect((await POST(req(`/submissions/${POST_ID}/reject`, { method: "POST", body: { reason: "fora do tema" } }), params(POST_ID))).status).toBe(200);
    expect(store.reviewPost).toHaveBeenLastCalledWith(TOKEN_HASH, POST_ID, "reject", "fora do tema");
  });

  it("publish retry and recovery are moderator-only", async () => {
    store.me.mockResolvedValue({ user_id: "u", moderator_handle: null });
    const pub = await import("./submissions/[id]/publish/route");
    const resume = await import("./maintenance/resume/route");
    expect((await pub.POST(req(`/submissions/${POST_ID}/publish`, { method: "POST" }), params(POST_ID))).status).toBe(403);
    expect((await resume.POST(req("/maintenance/resume", { method: "POST" }))).status).toBe(403);
    expect(service.runPublishFlow).not.toHaveBeenCalled();
    expect(service.resumeColetivo).not.toHaveBeenCalled();
    store.me.mockResolvedValue({ user_id: "u", moderator_handle: "xvlad" });
    expect((await resume.POST(req("/maintenance/resume", { method: "POST" }))).status).toBe(200);
    expect(service.resumeColetivo).toHaveBeenCalledWith({ maxPublishes: 5, deadlineMs: 20000 });
  });

  it("withdrawn post: 409 withdrawn, never requeued nor published", async () => {
    store.me.mockResolvedValue({ user_id: "u", moderator_handle: "xvlad" });
    const { POST } = await import("./submissions/[id]/publish/route");
    for (const status of ["failed", "approved"]) {
      store.getPost.mockResolvedValueOnce(row({ status, last_error_code: "withdrawn_by_author" }));
      const res = await POST(req(`/submissions/${POST_ID}/publish`, { method: "POST" }), params(POST_ID));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("withdrawn");
    }
    expect(store.requeuePublish).not.toHaveBeenCalled();
    expect(service.runPublishFlow).not.toHaveBeenCalled();
  });

  it("publish retry of a failed post requeues then runs; published -> 409", async () => {
    store.me.mockResolvedValue({ user_id: "u", moderator_handle: "xvlad" });
    const { POST } = await import("./submissions/[id]/publish/route");
    store.getPost.mockResolvedValueOnce(row({ status: "failed" })).mockResolvedValueOnce(row({ status: "published" }));
    expect((await POST(req(`/submissions/${POST_ID}/publish`, { method: "POST" }), params(POST_ID))).status).toBe(200);
    expect(store.requeuePublish).toHaveBeenCalledWith(TOKEN_HASH, POST_ID);
    store.getPost.mockResolvedValueOnce(row({ status: "published" }));
    expect((await POST(req(`/submissions/${POST_ID}/publish`, { method: "POST" }), params(POST_ID))).status).toBe(409);
  });
});

describe("feed", () => {
  it("app credential only; published items without moderation internals; stable cursor", async () => {
    const { GET } = await import("./feed/route");
    const items = Array.from({ length: 2 }, (_, i) => row({
      id: `5f0c2a7e-1b2c-4d3e-8f90-12345678900${i}`, status: "published", reject_reason: "x", last_error_code: "y",
      published_at: "2026-11-10T00:00:00.000Z", publish_author: "skateuser", author_handle: "h", author_display_name: "d", author_avatar_url: null,
    }));
    store.listFeed.mockResolvedValueOnce(items);
    const res = await GET(req("/feed?limit=2&context_kind=evento&context_slug=cine-xv", { auth: null }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.items[0]).not.toHaveProperty("reject_reason");
    expect(j.items[0]).not.toHaveProperty("last_error_code");
    expect(JSON.stringify(j)).not.toMatch(/@[a-z]+\.[a-z]/); // no emails
    expect(j.items[0].hive.url).toBe("https://skatehive.app/post/skateuser/coletivoxv-x");
    expect(j.next_cursor).toBeTruthy();
    expect(store.listFeed).toHaveBeenCalledWith({ kind: "evento", slug: "cine-xv" }, { before: null, beforeId: null, limit: 2 });
  });

  it("bad context/cursor -> 400", async () => {
    const { GET } = await import("./feed/route");
    expect((await GET(req("/feed?context_kind=evento", { auth: null }))).status).toBe(400);
    expect((await GET(req("/feed?context_kind=event&context_slug=x", { auth: null }))).status).toBe(400);
    expect((await GET(req("/feed?cursor=garbage", { auth: null }))).status).toBe(400);
    expect(store.listFeed).not.toHaveBeenCalled();
  });
});
