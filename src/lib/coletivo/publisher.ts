import { COLETIVO_APP_ID, hiveParentTag } from "./config";
import type { MediaItem, ContextRef } from "./validation";

// Publishing state machine for an approved Coletivo submission, published as a
// Skatehive SNAP: a reply to the current @peak.snaps container, exactly like the
// web/mobile composers (never a root/blog post). All I/O is injected.
//
// Guarantees:
//  - one publisher at a time: the store's claim is a CAS with a claim token;
//  - the full TARGET (author, signer kind, parent author, parent permlink) is
//    reserved in the DB (userbase_app_post_publish_reserve_target) BEFORE any
//    broadcast and never moves; containers rotate, so retries and
//    reconciliation only ever use the SAVED parent;
//  - the parent author is never empty: no container -> no broadcast;
//  - reconciliation first: a post at the target counts as ours only if author,
//    permlink, parent author, parent permlink AND json_metadata submission_id
//    all match; anything else there is a conflict, never "published";
//  - a reserved post without a saved parent (reserved by the old root-post
//    flow) is never published blindly and never marked published (0041's
//    guard forbids published without a parent): failed for a human with
//    legacy_target_unknown, the same code the DB uses;
//  - a different signer/target fails closed in the DB (target_changed).

export const SNAP_PARENT_AUTHOR = "peak.snaps";
export const SNAP_CONTAINER_RE = /^snap-container-[a-z0-9-]+$/;
export const SNAP_TAG = "snaps";

export type SnapTarget = { parentAuthor: string; parentPermlink: string };

export type PostForPublish = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  media: MediaItem[];
  context: ContextRef | null;
  publish_author: string | null;
  /** Fixed by the DB at insert. */
  publish_permlink: string;
  publish_parent_author: string | null;
  publish_parent_permlink: string | null;
};

export type Signer = { author: string; key: string; usingDefault: boolean };

export type HiveComment = {
  parentAuthor: string;
  parentPermlink: string;
  permlink: string;
  title: string;
  body: string;
  jsonMetadata: Record<string, unknown>;
};

/** What the chain holds at author/permlink (null: nothing). */
export type ChainPost = {
  author: string;
  permlink: string;
  /** null when the node did not return the field: never treated as "root". */
  parentAuthor: string | null;
  parentPermlink: string | null;
  submissionId: string | null;
} | null;

export type ReserveResult = "ok" | "lost" | "target_changed" | "legacy_target_unknown";

export type PublishStore = {
  /** CAS approved -> publishing (or take over an expired lease). null = next due post. */
  claim(postId: string | null): Promise<{ claimToken: string; post: PostForPublish } | null>;
  /** Reserve author + signer + parent once; the DB fails the post on any change. */
  reserve(
    postId: string,
    claimToken: string,
    target: { author: string; signerKind: "own_key" | "shared_default" } & SnapTarget
  ): Promise<ReserveResult>;
  /** Mark published; the DB queues the follow-ups (outbox) in the same transaction. */
  complete(postId: string, claimToken: string): Promise<boolean>;
  /** Report a failure; the DB decides approved (retry) vs failed (cap/terminal). */
  fail(postId: string, claimToken: string, errorCode: string, retryable: boolean): Promise<"approved" | "failed" | "lost">;
};

export type PublishDeps = {
  store: PublishStore;
  resolveSigner: (userId: string) => Promise<Signer>;
  /** Current @peak.snaps container (validated by the caller or here). */
  resolveSnapContainer: () => Promise<SnapTarget>;
  /** Pseudonymous id embedded for shared-account posts (feed overlay). */
  safeUserId: (userId: string) => string | null;
  getChainPost: (author: string, permlink: string) => Promise<ChainPost>;
  broadcast: (signer: Signer, comment: HiveComment) => Promise<void>;
  enabled: boolean;
};

export type PublishOutcome =
  | { status: "published"; postId?: string; author: string; permlink: string; reconciled: boolean }
  | { status: "busy" }
  | { status: "disabled" }
  | { status: "retryable"; code: string }
  | { status: "failed"; code: string };

export function isValidSnapTarget(t: SnapTarget | null | undefined): t is SnapTarget {
  return !!t && t.parentAuthor === SNAP_PARENT_AUTHOR && SNAP_CONTAINER_RE.test(t.parentPermlink);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Same iframe the web composer emits (generateVideoIframeMarkdown); /videos parses it. */
export function videoIframe(url: string, title: string): string {
  return [
    `<iframe src="${escapeAttr(url)}" `,
    `    title="${escapeAttr(title)}"`,
    `    width="100%" `,
    `    height="400"`,
    `    frameborder="0"`,
    `    loading="lazy"`,
    `    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"`,
    `    allowfullscreen>`,
    `</iframe>`,
  ].join("\n");
}

function videoTitle(post: PostForPublish): string {
  const fromText = `${post.title || ""}\n${post.body}`
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#>*_`~[\]()!]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return fromText?.slice(0, 80) || "Coletivo XV";
}

export function buildComment(
  post: PostForPublish,
  target: SnapTarget,
  permlink: string,
  opts: { safeUser?: string | null; env?: NodeJS.ProcessEnv } = {}
): HiveComment {
  if (!isValidSnapTarget(target)) throw new Error("invalid snap target");
  const lines: string[] = [];
  // Snaps have no title: the original title opens the body instead.
  if (post.title) lines.push(`**${post.title}**`);
  if (post.body) lines.push(post.body);
  for (const m of post.media) {
    if (m.type === "image") lines.push(`![](${m.url})`);
    else lines.push(videoIframe(m.url, videoTitle(post)));
  }
  const imageUrls = post.media.flatMap((m) => (m.type === "image" ? [m.url] : []));
  const posters = post.media.flatMap((m) => (m.type === "video" && m.poster ? [m.poster] : []));
  const community = hiveParentTag(opts.env);
  const metadata: Record<string, unknown> = {
    app: `${COLETIVO_APP_ID}/1.0`,
    format: "markdown",
    tags: [community, SNAP_TAG, COLETIVO_APP_ID],
    // Web composer fields.
    images: imageUrls,
    // Legacy field read by /videos (image[0] = thumbnail) and older clients:
    // the poster first for video snaps, then the images.
    image: [...posters, ...imageUrls],
    [COLETIVO_APP_ID]: { submission_id: post.id, context: post.context },
  };
  if (posters.length) metadata.thumbnail = posters;
  if (opts.safeUser) metadata.skatehive_user = opts.safeUser;
  return {
    parentAuthor: target.parentAuthor,
    parentPermlink: target.parentPermlink,
    permlink,
    title: "",
    body: lines.join("\n\n"),
    jsonMetadata: metadata,
  };
}

function errCode(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  // The DB accepts ^[a-z0-9_]{1,64}$ only.
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? `broadcast_${code.toLowerCase()}`
    : "broadcast_failed";
}

type Landed = "ours" | "absent" | "conflict";

/**
 * Ours only if author, permlink, submission_id AND the expected parent all
 * match; missing parent fields never match. Anything else there is a conflict.
 */
async function landedAt(
  deps: PublishDeps,
  postId: string,
  author: string,
  permlink: string,
  expected: SnapTarget
): Promise<Landed> {
  const c = await deps.getChainPost(author, permlink);
  if (!c) return "absent";
  const ours =
    c.author === author &&
    c.permlink === permlink &&
    c.submissionId === postId &&
    typeof c.parentAuthor === "string" &&
    typeof c.parentPermlink === "string" &&
    c.parentAuthor === expected.parentAuthor &&
    c.parentPermlink === expected.parentPermlink;
  return ours ? "ours" : "conflict";
}

/** Publish `requestedId`, or the next due approved/stale post when null. */
export async function publishPost(requestedId: string | null, deps: PublishDeps): Promise<PublishOutcome> {
  if (!deps.enabled) return { status: "disabled" };

  const claimed = await deps.store.claim(requestedId);
  if (!claimed) return { status: "busy" };
  const { claimToken, post } = claimed;
  const postId = post.id;
  const permlink = post.publish_permlink;

  const report = async (code: string, retryable: boolean): Promise<PublishOutcome> => {
    const r = await deps.store.fail(postId, claimToken, code, retryable);
    if (r === "lost") return { status: "busy" };
    return r === "approved" ? { status: "retryable", code } : { status: "failed", code };
  };
  const finish = async (author: string, reconciled: boolean): Promise<PublishOutcome> => {
    if (!(await deps.store.complete(postId, claimToken))) return { status: "busy" };
    return { status: "published", postId, author, permlink, reconciled };
  };

  const saved: SnapTarget | null =
    post.publish_parent_author || post.publish_parent_permlink
      ? { parentAuthor: post.publish_parent_author || "", parentPermlink: post.publish_parent_permlink || "" }
      : null;

  // 1) Already reserved. Without a valid saved snap parent it came from the old
  //    root-post flow: fail closed for a human, no chain call, no broadcast.
  if (post.publish_author) {
    if (!isValidSnapTarget(saved)) return report("legacy_target_unknown", false);
    let state: Landed;
    try {
      state = await landedAt(deps, postId, post.publish_author, permlink, saved);
    } catch {
      return report("chain_unavailable", true);
    }
    if (state === "ours") return finish(post.publish_author, true);
    if (state === "conflict") return report("destination_conflict", false);
  } else if (saved) {
    // A parent without an author should not exist; fail closed.
    return report("legacy_target_unknown", false);
  }

  // 2) Signer, then the target: saved one, or the current container.
  let signer: Signer;
  try {
    signer = await deps.resolveSigner(post.user_id);
  } catch {
    return report("signer_unavailable", true);
  }

  let target: SnapTarget;
  if (saved) {
    target = saved;
  } else {
    let container: SnapTarget;
    try {
      container = await deps.resolveSnapContainer();
    } catch {
      return report("snap_container_unavailable", true);
    }
    if (!isValidSnapTarget(container)) return report("snap_container_unavailable", true);
    target = container;
  }

  // Look at the destination before reserving/broadcasting (first attempt and
  // retries alike): never broadcast onto something already there.
  let pre: Landed;
  try {
    pre = await landedAt(deps, postId, signer.author, permlink, target);
  } catch {
    return report("chain_unavailable", true);
  }
  if (pre === "conflict") return report("destination_conflict", false);

  // 3) Reserve (first time) or re-confirm (retry) the full target in the DB.
  const reserved = await deps.store.reserve(postId, claimToken, {
    author: signer.author,
    signerKind: signer.usingDefault ? "shared_default" : "own_key",
    ...target,
  });
  if (reserved === "lost") return { status: "busy" };
  if (reserved === "target_changed" || reserved === "legacy_target_unknown") {
    return { status: "failed", code: reserved };
  }
  // Already on chain under exactly this target: record it, do not re-broadcast.
  if (pre === "ours") return finish(signer.author, true);

  const comment = buildComment(post, target, permlink, {
    safeUser: signer.usingDefault ? deps.safeUserId(post.user_id) : null,
  });

  // 4) Broadcast; on any error look at the chain before deciding.
  try {
    await deps.broadcast(signer, comment);
    return finish(signer.author, false);
  } catch (e) {
    try {
      const state = await landedAt(deps, postId, signer.author, permlink, target);
      if (state === "ours") return finish(signer.author, true);
      if (state === "conflict") return report("destination_conflict", false);
    } catch {
      /* unknown: keep it retryable; the next attempt reconciles first */
    }
    return report(errCode(e), true);
  }
}
