import { COLETIVO_APP_ID, hiveParentTag } from "./config";
import type { MediaItem, ContextRef } from "./validation";

// Publishing state machine for an approved submission. All I/O is injected so
// it can be tested without a DB or a chain write.
//
// Guarantees:
//  - one publisher at a time: the store's claim is a CAS that returns a claim
//    token (approved -> publishing, or a stale lease taken over);
//  - the permlink is fixed by the DB at insert; the author is reserved in the DB
//    (userbase_app_post_publish_reserve) BEFORE any broadcast and never moves,
//    so a retry only ever targets that destination;
//  - reconciliation comes first: if the persisted destination already holds
//    THIS submission on chain (json_metadata.coletivoxv.submission_id), it is
//    published, even if the signer or the template changed since;
//  - a post at the destination that is not this submission is a conflict, never
//    "published";
//  - a different signer fails closed (signer_changed, decided by the DB reserve)
//    instead of publishing elsewhere; content is immutable in the DB;
//  - side effects (soft-post attribution, Instagram queue) are NOT done here:
//    see sideEffects.ts, which has its own retryable state and never broadcasts.

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
export type ChainPost = { author: string; permlink: string; submissionId: string | null } | null;

export type PublishStore = {
  /** CAS approved -> publishing (or take over an expired lease). null = next due post. */
  claim(postId: string | null): Promise<{ claimToken: string; post: PostForPublish } | null>;
  /** Reserve the author once; the DB fails the post itself on signer change. */
  reserve(
    postId: string,
    claimToken: string,
    author: string,
    signerKind: "own_key" | "shared_default"
  ): Promise<"ok" | "lost" | "signer_changed">;
  /** Mark published; the DB queues the follow-ups (outbox) in the same transaction. */
  complete(postId: string, claimToken: string): Promise<boolean>;
  /** Report a failure; the DB decides approved (retry) vs failed (cap/terminal). */
  fail(postId: string, claimToken: string, errorCode: string, retryable: boolean): Promise<"approved" | "failed" | "lost">;
};

export type PublishDeps = {
  store: PublishStore;
  resolveSigner: (userId: string) => Promise<Signer>;
  /** Pseudonymous id embedded for shared-account posts (feed overlay). */
  safeUserId: (userId: string) => string | null;
  getChainPost: (author: string, permlink: string) => Promise<ChainPost>;
  broadcast: (signer: Signer, comment: HiveComment) => Promise<void>;
  enabled: boolean;
};

export type PublishOutcome =
  | { status: "published"; postId?: string; author: string; permlink: string; reconciled: boolean }
  | { status: "busy" } // someone else holds the claim, or not approved
  | { status: "disabled" }
  | { status: "retryable"; code: string }
  | { status: "failed"; code: string };

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildComment(
  post: PostForPublish,
  permlink: string,
  opts: { safeUser?: string | null; env?: NodeJS.ProcessEnv } = {}
): HiveComment {
  const lines = post.body ? [post.body] : [];
  for (const m of post.media) {
    if (m.type === "image") lines.push(`![](${m.url})`);
    // Same iframe shape the Skatehive feed/videos extractor recognizes.
    else lines.push(`<iframe src="${escapeAttr(m.url)}" allowfullscreen></iframe>`);
  }
  const title = post.title || post.body.replace(/\s+/g, " ").trim().slice(0, 80) || "Coletivo XV";
  const tag = hiveParentTag(opts.env);
  const images = post.media.flatMap((m) => (m.type === "image" ? [m.url] : m.poster ? [m.poster] : []));
  const metadata: Record<string, unknown> = {
    app: `${COLETIVO_APP_ID}/1.0`,
    format: "markdown",
    tags: [tag, COLETIVO_APP_ID],
    image: images,
    [COLETIVO_APP_ID]: { submission_id: post.id, context: post.context },
  };
  if (opts.safeUser) metadata.skatehive_user = opts.safeUser;
  return { parentAuthor: "", parentPermlink: tag, permlink, title, body: lines.join("\n\n"), jsonMetadata: metadata };
}

function errCode(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  // The DB accepts ^[a-z0-9_]{1,64}$ only.
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? `broadcast_${code.toLowerCase()}`
    : "broadcast_failed";
}

type Landed = "ours" | "absent" | "conflict";

async function landedAt(deps: PublishDeps, postId: string, author: string, permlink: string): Promise<Landed> {
  const onChain = await deps.getChainPost(author, permlink);
  if (!onChain) return "absent";
  if (onChain.author === author && onChain.permlink === permlink && onChain.submissionId === postId) return "ours";
  return "conflict";
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

  // 1) Reconcile the reserved destination before anything else.
  if (post.publish_author) {
    let state: Landed;
    try {
      state = await landedAt(deps, post.id, post.publish_author, permlink);
    } catch {
      return report("chain_unavailable", true);
    }
    if (state === "ours") return finish(post.publish_author, true);
    if (state === "conflict") return report("destination_conflict", false);
  }

  // 2) Not on chain yet: resolve the signer and reserve/verify the author.
  let signer: Signer;
  try {
    signer = await deps.resolveSigner(post.user_id);
  } catch {
    return report("signer_unavailable", true);
  }
  if (!post.publish_author) {
    try {
      if ((await landedAt(deps, post.id, signer.author, permlink)) === "conflict") {
        return report("destination_conflict", false);
      }
    } catch {
      return report("chain_unavailable", true);
    }
  }
  const reserved = await deps.store.reserve(
    postId,
    claimToken,
    signer.author,
    signer.usingDefault ? "shared_default" : "own_key"
  );
  if (reserved === "lost") return { status: "busy" };
  if (reserved === "signer_changed") return { status: "failed", code: "signer_changed" };

  const comment = buildComment(post, permlink, {
    safeUser: signer.usingDefault ? deps.safeUserId(post.user_id) : null,
  });

  // 3) Broadcast; on any error look at the chain before deciding.
  try {
    await deps.broadcast(signer, comment);
    return finish(signer.author, false);
  } catch (e) {
    try {
      const state = await landedAt(deps, post.id, signer.author, permlink);
      if (state === "ours") return finish(signer.author, true);
      if (state === "conflict") return report("destination_conflict", false);
    } catch {
      /* unknown: keep it retryable; the next attempt reconciles first */
    }
    return report(errCode(e), true);
  }
}
