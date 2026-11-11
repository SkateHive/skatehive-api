import { describe, expect, it, vi } from "vitest";
import { extractVideosFromPost } from "@/lib/video-extraction";
import {
  buildComment, publishPost,
  type ChainPost, type PostForPublish, type PublishDeps, type PublishStore, type SnapTarget,
} from "./publisher";

const POST_ID = "5f0c2a7e-1b2c-4d3e-8f90-123456789abc";
const PERMLINK = "coletivoxv-5f0c2a7e1b2c4d3e8f90123456789abc";
const C1: SnapTarget = { parentAuthor: "peak.snaps", parentPermlink: "snap-container-1794317040" };
const C2: SnapTarget = { parentAuthor: "peak.snaps", parentPermlink: "snap-container-1794403440" };

// In-memory store mirroring the 0038/0041 RPC semantics: claim CAS + lease,
// reserve_target once (author+signer+parent) with target_changed, complete, fail.
function makeStore(post: Partial<PostForPublish> = {}, status = "approved", attempts = 0, max = 5) {
  const state = {
    status, attempts, claimToken: null as string | null, lastError: null as string | null, n: 0,
    post: {
      id: POST_ID, user_id: "user-1", title: null, body: "manobra", media: [], context: null,
      publish_author: null, publish_permlink: PERMLINK, publish_parent_author: null, publish_parent_permlink: null,
      ...post,
    } as PostForPublish,
    // A pre-reserved fixture behaves as reserved with the shared default signer.
    signerKind: (post.publish_author ? "shared_default" : null) as string | null,
    legacyDetail: null as string | null,
  };
  const store: PublishStore = {
    async claim() {
      if (state.status !== "approved" || state.attempts >= max) return null;
      state.status = "publishing";
      state.attempts += 1;
      state.claimToken = `t${++state.n}`;
      return { claimToken: state.claimToken, post: { ...state.post } };
    },
    async reserve(_id, t, target) {
      if (t !== state.claimToken) return "lost";
      const p = state.post;
      if (!p.publish_author) {
        Object.assign(p, { publish_author: target.author, publish_parent_author: target.parentAuthor, publish_parent_permlink: target.parentPermlink });
        state.signerKind = target.signerKind;
        return "ok";
      }
      if (p.publish_author === target.author && state.signerKind === target.signerKind &&
          p.publish_parent_author === target.parentAuthor && p.publish_parent_permlink === target.parentPermlink) return "ok";
      Object.assign(state, { status: "failed", lastError: "target_changed", claimToken: null });
      return "target_changed";
    },
    async complete(_id, t) {
      if (t !== state.claimToken || !state.post.publish_author) return false;
      Object.assign(state, { status: "published", claimToken: null });
      return true;
    },
    async markLegacy(_id, t, detail) {
      if (t !== state.claimToken || !state.post.publish_author || state.post.publish_parent_author) return "lost";
      Object.assign(state, { status: "failed", lastError: "legacy_target_unknown", legacyDetail: detail, claimToken: null });
      return "failed";
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
const onChain = (over: Partial<NonNullable<ChainPost>> = {}): ChainPost => ({
  author: "skateuser", permlink: PERMLINK, parentAuthor: C1.parentAuthor, parentPermlink: C1.parentPermlink, submissionId: POST_ID, ...over,
});

function deps(store: PublishStore, over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    store, enabled: true,
    resolveSigner: vi.fn(async () => signer),
    resolveSnapContainer: vi.fn(async () => C1),
    safeUserId: () => "safe123",
    getChainPost: vi.fn(async () => null),
    broadcast: vi.fn(async () => {}),
    ...over,
  };
}

describe("publishPost as a SNAP (never a blog)", () => {
  it("disabled: no claim, no chain call", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { enabled: false });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "disabled" });
    expect(state.status).toBe("approved");
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("happy path: reply to the current container, target saved BEFORE broadcast, empty title", async () => {
    const { store, state } = makeStore();
    const broadcast = vi.fn(async (_s, c) => {
      expect(state.post.publish_parent_author).toBe("peak.snaps");
      expect(state.post.publish_parent_permlink).toBe(C1.parentPermlink);
      expect(c).toMatchObject({ parentAuthor: "peak.snaps", parentPermlink: C1.parentPermlink, title: "", permlink: PERMLINK });
    });
    expect(await publishPost(POST_ID, deps(store, { broadcast }))).toMatchObject({ status: "published", author: "skateuser", reconciled: false });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("anti-blog: every broadcast has a non-empty peak.snaps parent", async () => {
    for (const media of [[], [{ type: "image" as const, url: "https://images.hive.blog/a.jpg" }]]) {
      const { store } = makeStore({ media, body: media.length ? "" : "texto" });
      const broadcast = vi.fn(async () => {});
      await publishPost(POST_ID, deps(store, { broadcast }));
      for (const [, c] of broadcast.mock.calls as unknown as Array<[unknown, { parentAuthor: string; parentPermlink: string }]>) {
        expect(c.parentAuthor).toBe("peak.snaps");
        expect(c.parentPermlink).toMatch(/^snap-container-/);
      }
    }
  });

  it("container lookup fails -> retryable snap_container_unavailable, ZERO broadcast, nothing reserved", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { resolveSnapContainer: vi.fn(async () => { throw new Error("rpc"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "snap_container_unavailable" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.post.publish_author).toBeNull();
  });

  it.each([
    { parentAuthor: "", parentPermlink: "hive-173115" }, // a root/blog target
    { parentAuthor: "someone", parentPermlink: "snap-container-1" },
    { parentAuthor: "peak.snaps", parentPermlink: "re-some-reply" },
    { parentAuthor: "peak.snaps", parentPermlink: "" },
  ])("invalid container %o -> ZERO broadcast", async (bad) => {
    const { store } = makeStore();
    const d = deps(store, { resolveSnapContainer: vi.fn(async () => bad) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "snap_container_unavailable" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("container rotates between attempts: the retry keeps the SAVED parent", async () => {
    const { store, state } = makeStore();
    const resolveSnapContainer = vi.fn().mockResolvedValueOnce(C1).mockResolvedValue(C2);
    const broadcast = vi.fn().mockRejectedValueOnce(Object.assign(new Error("t"), { code: "ETIMEDOUT" })).mockResolvedValueOnce(undefined);
    const d = deps(store, { resolveSnapContainer, broadcast });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "broadcast_etimedout" });
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published" });
    expect(broadcast.mock.calls[1][1].parentPermlink).toBe(C1.parentPermlink);
    expect(resolveSnapContainer).toHaveBeenCalledTimes(1); // never re-resolved once saved
    expect(state.post.publish_parent_permlink).toBe(C1.parentPermlink);
  });

  it("timeout that landed under the saved parent: reconciled, no second broadcast", async () => {
    const { store } = makeStore();
    const getChainPost = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(onChain());
    const broadcast = vi.fn(async () => { throw Object.assign(new Error("t"), { code: "ETIMEDOUT" }); });
    expect(await publishPost(POST_ID, deps(store, { getChainPost, broadcast }))).toMatchObject({ status: "published", reconciled: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("parent mismatch on chain (same author/permlink/submission, other parent) -> conflict, never published", async () => {
    const { store, state } = makeStore({ publish_author: "skateuser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentAuthor: "", parentPermlink: "hive-173115" })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
  });

  it("foreign content (other submission) at the destination -> conflict", async () => {
    const { store } = makeStore();
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ submissionId: "other" })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("legacy PUBLISHED post (root, parent null) is never claimed or touched", async () => {
    const { store, state } = makeStore({ publish_author: "xvlad" }, "published");
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "busy" });
    expect(d.getChainPost).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("published");
  });

  it("legacy APPROVED post reserved without a parent, not on chain -> mark_legacy 'not on chain', no broadcast, never complete", async () => {
    const { store, state } = makeStore({ publish_author: "skateuser" });
    const complete = vi.spyOn(store, "complete");
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "legacy_target_unknown" });
    expect(d.resolveSnapContainer).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: "failed", lastError: "legacy_target_unknown", legacyDetail: "not on chain" });
  });

  it("legacy reserved without a parent and its ROOT found on chain -> mark_legacy with that detail, NEVER complete/broadcast", async () => {
    const { store, state } = makeStore({ publish_author: "skateuser" });
    const complete = vi.spyOn(store, "complete");
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentAuthor: "", parentPermlink: "hive-173115" })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "legacy_target_unknown" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(state.legacyDetail).toBe(`root on chain: skateuser/${PERMLINK}`);
  });

  it("legacy with chain down -> still mark_legacy (detail 'chain unavailable'), no broadcast", async () => {
    const { store, state } = makeStore({ publish_author: "skateuser" });
    const d = deps(store, { getChainPost: vi.fn(async () => { throw new Error("rpc"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "legacy_target_unknown" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.legacyDetail).toBe("chain unavailable");
  });

  it("unreserved post ALREADY on chain under exactly the current target -> reserve target + published (reconciled), NO broadcast", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { getChainPost: vi.fn(async () => onChain()) });
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published", reconciled: true, author: "skateuser" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.post).toMatchObject({ publish_author: "skateuser", publish_parent_author: "peak.snaps", publish_parent_permlink: C1.parentPermlink });
  });

  it("unreserved post on chain with the same submission but ANOTHER parent -> conflict, nothing reserved", async () => {
    const { store, state } = makeStore();
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentPermlink: "snap-container-1" })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.post.publish_author).toBeNull();
  });

  it("chain post missing parent fields is never proof of ours (or of a root) -> conflict", async () => {
    const { store } = makeStore({ publish_author: "skateuser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentAuthor: null, parentPermlink: null })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("signer/target changed: the DB fails it (target_changed), no broadcast, no auto-requeue", async () => {
    const { store, state } = makeStore({ publish_author: "olduser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "target_changed" });
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
    expect(await publishPost(POST_ID, d)).toEqual({ status: "busy" }); // stays failed
  });

  it("race: two concurrent publishers -> exactly one broadcast", async () => {
    const { store } = makeStore();
    const broadcast = vi.fn(async () => {});
    const [a, b] = await Promise.all([publishPost(POST_ID, deps(store, { broadcast })), publishPost(POST_ID, deps(store, { broadcast }))]);
    expect([a.status, b.status].sort()).toEqual(["busy", "published"]);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("chain unavailable during reconcile: retryable, no broadcast", async () => {
    const { store } = makeStore({ publish_author: "skateuser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const d = deps(store, { getChainPost: vi.fn(async () => { throw new Error("rpc"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "retryable", code: "chain_unavailable" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("attempt cap reached: failed", async () => {
    const { store } = makeStore({}, "approved", 4, 5);
    const d = deps(store, { broadcast: vi.fn(async () => { throw new Error("x"); }) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "broadcast_failed" });
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

describe("buildComment (snap contract)", () => {
  const base: PostForPublish = {
    id: POST_ID, user_id: "u", title: null, body: "", media: [], context: null,
    publish_author: null, publish_permlink: PERMLINK, publish_parent_author: null, publish_parent_permlink: null,
  };
  const env = {} as NodeJS.ProcessEnv;

  it("reply to the container, empty title, original title opens the body, snap tags + origin block", () => {
    const c = buildComment({ ...base, title: "Arte do Corre", body: "ollie do palco", context: { kind: "evento", slug: "arte-do-corre" } }, C1, PERMLINK, { env, safeUser: "s1" });
    expect(c).toMatchObject({ parentAuthor: "peak.snaps", parentPermlink: C1.parentPermlink, title: "", permlink: PERMLINK });
    expect(c.body.startsWith("**Arte do Corre**\n\nollie do palco")).toBe(true);
    expect(c.jsonMetadata).toMatchObject({
      app: "coletivoxv/1.0",
      tags: ["hive-173115", "snaps", "coletivoxv"],
      coletivoxv: { submission_id: POST_ID, context: { kind: "evento", slug: "arte-do-corre" } },
      skatehive_user: "s1",
    });
  });

  it("refuses a non-snap target (never builds a root post)", () => {
    expect(() => buildComment({ ...base, body: "x" }, { parentAuthor: "", parentPermlink: "hive-173115" }, PERMLINK, { env })).toThrow();
  });

  it("photos: markdown in body, images + legacy image", () => {
    const c = buildComment({ ...base, media: [{ type: "image", url: "https://images.hive.blog/a.jpg" }] }, C1, PERMLINK, { env });
    expect(c.body).toBe("![](https://images.hive.blog/a.jpg)");
    expect(c.jsonMetadata).toMatchObject({ images: ["https://images.hive.blog/a.jpg"], image: ["https://images.hive.blog/a.jpg"] });
    expect(c.jsonMetadata).not.toHaveProperty("thumbnail");
  });

  it("video: web iframe format that /videos parses, poster as thumbnail and image[0]", () => {
    const video = "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44);
    const poster = "https://images.hive.blog/p.jpg";
    const c = buildComment({ ...base, body: "ollie", media: [{ type: "video", url: video, poster }] }, C1, PERMLINK, { env });
    expect(c.body).toContain(`<iframe src="${video}" `);
    expect(c.body).toContain('allowfullscreen>\n</iframe>');
    expect(c.jsonMetadata).toMatchObject({ thumbnail: [poster], image: [poster], images: [] });
    const [entry] = extractVideosFromPost({ author: "skateuser", permlink: PERMLINK, body: c.body, post_json_metadata: JSON.stringify(c.jsonMetadata) });
    expect(entry).toMatchObject({ videoUrl: video, thumbnailUrl: poster });
  });

  it("escapes attribute values", () => {
    const c = buildComment({ ...base, body: 'a"<b>', media: [{ type: "video", url: 'https://ipfs.skatehive.app/ipfs/Qm"x' }] }, C1, PERMLINK, { env });
    expect(c.body).toContain('src="https://ipfs.skatehive.app/ipfs/Qm&quot;x"');
    expect(c.body).toContain('title="a&quot;&lt;b"'); // ">" stripped like the web composer
  });
});

describe("articles (root post) and the empty-string parent", () => {
  const ART: SnapTarget = { parentAuthor: "", parentPermlink: "hive-173115" };
  const art = (over: Partial<PostForPublish> = {}) => makeStore({ publication_type: "article", title: "Arte do Corre", body: "texto", ...over });

  it("new article: root target ('' + hive-173115) saved before broadcast, title on chain, no container lookup", async () => {
    const { store, state } = art();
    const broadcast = vi.fn(async (_s, c) => {
      expect(state.post.publish_parent_author).toBe("");
      expect(state.post.publish_parent_permlink).toBe("hive-173115");
      expect(c).toMatchObject({ parentAuthor: "", parentPermlink: "hive-173115", title: "Arte do Corre" });
      expect(c.jsonMetadata.tags).toEqual(["hive-173115", "coletivoxv"]);
      expect(c.jsonMetadata.coletivoxv.publication_type).toBe("article");
      expect(c.body.startsWith("**")).toBe(false); // title is not repeated in the body
    });
    const d = deps(store, { broadcast });
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published" });
    expect(d.resolveSnapContainer).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("saved parent '' is a REAL saved target (not 'absent'): retry broadcasts to it, never mark_legacy", async () => {
    const { store, state } = art({ publish_author: "skateuser", publish_parent_author: "", publish_parent_permlink: "hive-173115" });
    const mark = vi.spyOn(store, "markLegacy");
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published" });
    expect(mark).not.toHaveBeenCalled();
    expect(d.resolveSnapContainer).not.toHaveBeenCalled();
    expect((d.broadcast as any).mock.calls[0][1]).toMatchObject(ART);
    expect(state.status).toBe("published");
  });

  it("article reconcile: on chain under '' + community with this submission -> published, no broadcast", async () => {
    const { store } = art({ publish_author: "skateuser", publish_parent_author: "", publish_parent_permlink: "hive-173115" });
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentAuthor: "", parentPermlink: "hive-173115" })) });
    expect(await publishPost(POST_ID, d)).toMatchObject({ status: "published", reconciled: true });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("type/target mismatch never broadcasts: article with a saved snap parent, snap with a saved article parent", async () => {
    const a = art({ publish_author: "skateuser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const da = deps(a.store);
    expect(await publishPost(POST_ID, da)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(da.broadcast).not.toHaveBeenCalled();
    const s = makeStore({ publish_author: "skateuser", publish_parent_author: "", publish_parent_permlink: "hive-173115" });
    const ds = deps(s.store);
    expect(await publishPost(POST_ID, ds)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(ds.broadcast).not.toHaveBeenCalled();
  });

  it("half-saved parent (one NULL, one set) -> legacy_target_unknown, no broadcast", async () => {
    const { store } = art({ publish_author: "skateuser", publish_parent_author: "", publish_parent_permlink: null });
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "legacy_target_unknown" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("legacy NULL parent still goes to mark_legacy (unchanged)", async () => {
    const { store, state } = art({ publish_author: "skateuser" });
    const d = deps(store);
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "legacy_target_unknown" });
    expect(state.legacyDetail).toBe("not on chain");
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("ROLLBACK anti-mismatch: if the DB refuses the reservation (0043 UB422 for an article reserved as snap by an older API), NOTHING is broadcast", async () => {
    const { store } = makeStore({ publication_type: "snap" });
    store.reserve = vi.fn(async () => { throw Object.assign(new Error("destination does not fit the post type"), { status: 422, code: "invalid" }); });
    const d = deps(store);
    await expect(publishPost(POST_ID, d)).rejects.toThrow();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("buildComment article: cover = first photo first in image[]; same media rules (photos + video appended)", () => {
    const video = "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44);
    const c = buildComment(
      { id: POST_ID, user_id: "u", title: "T", body: "b", context: null, publication_type: "article",
        media: [{ type: "image", url: "https://images.hive.blog/cover.jpg" }, { type: "image", url: "https://images.hive.blog/2.jpg" }, { type: "video", url: video, poster: "https://images.hive.blog/p.jpg" }],
        publish_author: null, publish_permlink: PERMLINK, publish_parent_author: null, publish_parent_permlink: null },
      ART, PERMLINK, { env: {} as NodeJS.ProcessEnv }
    );
    expect(c.title).toBe("T");
    expect(c.jsonMetadata.images).toEqual(["https://images.hive.blog/cover.jpg", "https://images.hive.blog/2.jpg"]);
    expect(c.body).toContain("![](https://images.hive.blog/cover.jpg)");
    expect(c.body).toContain(`<iframe src="${video}" `);
    expect(() => buildComment({ id: POST_ID, user_id: "u", title: "T", body: "b", context: null, publication_type: "article", media: [], publish_author: null, publish_permlink: PERMLINK, publish_parent_author: null, publish_parent_permlink: null }, C1, PERMLINK, { env: {} as NodeJS.ProcessEnv })).toThrow();
  });

  it("type check comes BEFORE reconcile: article with a saved SNAP parent that is even 'ours' on chain -> conflict, no complete/broadcast", async () => {
    const { store, state } = art({ publish_author: "skateuser", publish_parent_author: C1.parentAuthor, publish_parent_permlink: C1.parentPermlink });
    const complete = vi.spyOn(store, "complete");
    const d = deps(store, { getChainPost: vi.fn(async () => onChain()) }); // ours under the snap parent
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(complete).not.toHaveBeenCalled();
    expect(d.getChainPost).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(state.status).toBe("failed");
  });

  it("snap with a saved ARTICLE parent that is 'ours' on chain -> conflict, no complete", async () => {
    const { store } = makeStore({ publish_author: "skateuser", publish_parent_author: "", publish_parent_permlink: "hive-173115" });
    const complete = vi.spyOn(store, "complete");
    const d = deps(store, { getChainPost: vi.fn(async () => onChain({ parentAuthor: "", parentPermlink: "hive-173115" })) });
    expect(await publishPost(POST_ID, d)).toEqual({ status: "failed", code: "destination_conflict" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("image[0]: article cover = first photo even with a video poster; snap keeps the poster first", () => {
    const video = { type: "video" as const, url: "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44), poster: "https://images.hive.blog/p.jpg" };
    const photo = { type: "image" as const, url: "https://images.hive.blog/cover.jpg" };
    const base = { id: POST_ID, user_id: "u", title: "T", body: "b", context: null, media: [video, photo], publish_author: null, publish_permlink: PERMLINK, publish_parent_author: null, publish_parent_permlink: null };
    const a = buildComment({ ...base, publication_type: "article" }, ART, PERMLINK, { env: {} as NodeJS.ProcessEnv });
    expect((a.jsonMetadata.image as string[])[0]).toBe(photo.url);
    expect(a.jsonMetadata.thumbnail).toEqual([video.poster]);
    const s = buildComment({ ...base, publication_type: "snap" }, C1, PERMLINK, { env: {} as NodeJS.ProcessEnv });
    expect((s.jsonMetadata.image as string[])[0]).toBe(video.poster);
  });
});

