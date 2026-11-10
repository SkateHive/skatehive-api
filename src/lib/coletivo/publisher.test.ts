import { describe, expect, it, vi } from "vitest";
import { buildComment, publishPost, type ChainPost, type PostForPublish, type PublishDeps, type PublishStore } from "./publisher";

const POST_ID = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const PERMLINK = "coletivoxv-5f0c2a7e1b2c4d3e8f90123456789abc";

// In-memory store mirroring the 0038 RPC semantics (claim CAS + lease token,
// reserve-once with signer_changed, complete, fail with attempt cap).
function makeStore(post: Partial<PostForPublish> = {}, status = "approved", attempts = 0, max = 5) {
  const state = {
    status, attempts, claimToken: null as string | null, lastError: null as string | null, n: 0,
    post: { id: POST_ID, user_id: "user-1", title: null, body: "manobra", media: [], context: null,
      publish_author: null, publish_permlink: PERMLINK, ...post } as PostForPublish,
    signerKind: null as string | null,
  };
  const store: PublishStore = {
    async claim() {
      if (state.status !== "approved" || state.attempts >= max) return null;
      state.status = "publishing";
      state.attempts += 1;
      state.claimToken = `t${++state.n}`;
      return { claimToken: state.claimToken, post: { ...state.post } };
    },
    async reserve(_id, t, author, kind) {
      if (t !== state.claimToken) return "lost";
      if (!state.post.publish_author) {
        state.post.publish_author = author;
        state.signerKind = kind;
        return "ok";
      }
      if (state.post.publish_author === author && state.signerKind === kind) return "ok";
      state.status = "failed";
      state.lastError = "signer_changed";
      state.claimToken = null;
      return "signer_changed";
    },
    async complete(_id, t) {
      if (t !== state.claimToken || !state.post.publish_author) return false;
      state.status = "published";
      state.claimToken = null;
      return true;
    },
    async fail(_id, t, code, retryable) {
      if (t !== state.claimToken) return "lost";
      state.status = retryable && state.attempts < max ? "approved" : "failed";
      state.lastError = code;
      state.claimToken = null;
      return state.status as "approved" | "failed";
    },
  };
  return { store, state };
}

const signer = { author: "skateuser", key: "k", usingDefault: true };
const ours = (author = "skateuser"): ChainPost => ({ author, permlink: PERMLINK, submissionId: POST_ID });
const foreign = (): ChainPost => ({ author: "skateuser", permlink: PERMLINK, submissionId: "someone-else" });

function deps(store: PublishStore, over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    store, enabled: true,
    resolveSigner: vi.fn(async () => signer),
    safeUserId: () => "safe123",
    getChainPost: vi.fn(async () => null),
    broadcast: vi.fn(async () => {}),
    ...over,
  };
}

describe("publishPost", () => {
  it("disabled: no claim, no chain call", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { enabled: false });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "disabled" });
    expect(state.status).toBe("approved");
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("happy path: author reserved before broadcast, DB permlink, skatehive_user for shared signer", async () => {
    const { store, state } = makeStore();
    const broadcast = vi.fn(async (_s, c) => {
      expect(state.post.publish_author).toBe("skateuser");
      expect(c.permlink).toBe(PERMLINK);
      expect(c.jsonMetadata.skatehive_user).toBe("safe123");
    });
    expect(await publishPost(POST_ID, deps(store, { broadcast }))).toEqual({ status: "published", postId: POST_ID, author: "skateuser", permlink: PERMLINK, reconciled: false });
    expect(state.status).toBe("published");
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("own key: no skatehive_user", async () => {
    const { store } = makeStore();
    const broadcast = vi.fn(async (_s, c) => { expect(c.jsonMetadata).not.toHaveProperty("skatehive_user"); });
    await publishPost(POST_ID, deps(store, { broadcast, resolveSigner: async () => ({ author: "xvlad", key: "k", usingDefault: false }) }));
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("race: two concurrent publishers -> exactly one broadcast", async () => {
    const { store } = makeStore();
    const broadcast = vi.fn(async () => {});
    const [a, b] = await Promise.all([publishPost(POST_ID, deps(store, { broadcast })), publishPost(POST_ID, deps(store, { broadcast }))]);
    expect([a.status, b.status].sort()).toEqual(["busy", "published"]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("timeout that landed: chain shows THIS submission -> reconciled, no second broadcast", async () => {
    const { store, state } = makeStore();
    const getChainPost = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ours());
    const broadcast = vi.fn(async () => { throw Object.assign(new Error("t"), { code: "ETIMEDOUT" }); });
    expect(await publishPost(POST_ID, deps(store, { getChainPost, broadcast }))).toMatchObject({ status: "published", reconciled: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("published");
  });

  it("foreign content at the destination: conflict (terminal), never 'published'", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { getChainPost: vi.fn(async () => foreign()) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
  });

  it("timeout that did not land: retryable with a DB-safe code; retry hits the SAME author/permlink", async () => {
    const { store, state } = makeStore();
    const broadcast = vi.fn().mockRejectedValueOnce(Object.assign(new Error("t"), { code: "ETIMEDOUT" })).mockResolvedValueOnce(undefined);
    const d = deps(store, { broadcast });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "broadcast_etimedout" });
    expect(state.lastError).toMatch(/^[a-z0-9_]{1,64}$/);
    expect(state.status).toBe("approved");
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published" });
    expect(broadcast.mock.calls[1][1].permlink).toBe(PERMLINK);
    expect(broadcast.mock.calls[1][0].author).toBe("skateuser");
  });

  it("reconcile FIRST: signer changed but the post is already on chain -> published, signer not consulted", async () => {
    const { store } = makeStore({ publish_author: "olduser" });
    const resolveSigner = vi.fn(async () => signer);
    const d = deps(store, { resolveSigner, getChainPost: vi.fn(async () => ours("olduser")) });
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published", author: "olduser", reconciled: true });
    expect(resolveSigner).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("signer changed and nothing on chain: DB fails it (signer_changed), no broadcast", async () => {
    const { store, state } = makeStore({ publish_author: "olduser" });
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "signer_changed" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
  });

  it("chain unavailable during reconcile: retryable, no broadcast", async () => {
    const { store } = makeStore({ publish_author: "skateuser" });
    const d = deps(store, { getChainPost: vi.fn(async () => { throw new Error("rpc"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "chain_unavailable" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("attempt cap reached by the DB: failed", async () => {
    const { store, state } = makeStore({}, "approved", 4, 5);
    const d = deps(store, { broadcast: vi.fn(async () => { throw new Error("x"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "broadcast_failed" });
    expect(state.status).toBe("failed");
  });

  it("recovery: claim(null) publishes the next due post", async () => {
    const { store } = makeStore();
    expect(await publishPost(null, deps(store))).toMatchObject({ status: "published", postId: POST_ID });
  });

  it("not approved: busy, nothing happens", async () => {
    for (const s of ["pending", "rejected", "published", "publishing", "failed"]) {
      const { store } = makeStore({}, s);
      const d = deps(store);
      expect(await publishPost(POST_ID, d)).toEqual({ status: "busy" });
      expect(d.broadcast).not.toHaveBeenCalled();
    }
  });
});

describe("buildComment", () => {
  const base = { id: POST_ID, user_id: "u", title: null, context: null, publish_author: null, publish_permlink: PERMLINK };
  it("top-level community post, origin metadata, image + iframe video the feed recognizes, escaped src", () => {
    const c = buildComment(
      { ...base, body: "texto", context: { kind: "evento", slug: "cine-xv" }, media: [
        { type: "image", url: "https://images.hive.blog/a.jpg" },
        { type: "video", url: 'https://ipfs.skatehive.app/ipfs/Qm"x', poster: "https://images.hive.blog/p.jpg" },
      ] },
      PERMLINK, { env: {} as NodeJS.ProcessEnv }
    );
    expect(c).toMatchObject({ parentAuthor: "", parentPermlink: "hive-173115", title: "texto", permlink: PERMLINK });
    expect(c.body).toContain("![](https://images.hive.blog/a.jpg)");
    expect(c.body).toMatch(/<iframe src="https:\/\/ipfs\.skatehive\.app\/ipfs\/Qm&quot;x" allowfullscreen><\/iframe>/);
    expect(c.jsonMetadata).toMatchObject({ app: "coletivoxv/1.0", image: ["https://images.hive.blog/a.jpg", "https://images.hive.blog/p.jpg"], coletivoxv: { submission_id: POST_ID } });
  });
  it("media-only post: body is the media markdown, title falls back", () => {
    const c = buildComment({ ...base, body: "", media: [{ type: "image", url: "https://images.hive.blog/a.jpg" }] }, PERMLINK, { env: {} as NodeJS.ProcessEnv });
    expect(c.body).toBe("![](https://images.hive.blog/a.jpg)");
    expect(c.title).toBe("Coletivo XV");
  });
});
