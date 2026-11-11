import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { COLETIVO_APP_ID, LIMITS } from "./config";
import type { PostForPublish, PublishStore } from "./publisher";
import { FOLLOWUP_KINDS, type FollowupKind, type OutboxItem } from "./sideEffects";
import type { MediaItem, ContextRef } from "./validation";

// Thin adapter over the 0038 RPCs (skatehive3.0 sql/migrations/0038). Every
// user-facing call passes the APP session token hash; the DB resolves the user
// (and the email it was issued through) itself. The API never sends a user id
// for an author or moderator.

export class StoreError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const UB: Record<string, [number, string]> = {
  UB401: [401, "unauthorized"],
  UB403: [403, "forbidden"],
  UB404: [404, "not_found"],
  UB409: [409, "conflict"],
  UB410: [410, "challenge_expired_or_used"],
  UB422: [422, "invalid"],
  UB429: [429, "rate_limited"],
};

/** Map a PostgREST/Postgres error to an API error; never leak the message. */
export function toStoreError(error: { code?: string } | null | undefined): StoreError {
  const hit = error?.code ? UB[error.code] : undefined;
  if (hit) return new StoreError(hit[0], hit[1]);
  const code = typeof error?.code === "string" && /^[A-Z0-9]{1,8}$/.test(error.code) ? error.code : "unknown";
  console.error("[coletivo/store] rpc failed", code);
  return new StoreError(503, "unavailable");
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;

function client(): { rpc: Rpc } {
  if (!supabaseAdmin) throw new StoreError(503, "unavailable");
  return supabaseAdmin as unknown as { rpc: Rpc };
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Awaited<ReturnType<Rpc>>;
  try {
    res = await client().rpc(fn, args);
  } catch (e) {
    if (e instanceof StoreError) throw e;
    throw toStoreError(null);
  }
  if (res.error) throw toStoreError(res.error);
  return res.data as T;
}

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return data ? [data as T] : [];
}

function one<T>(data: unknown): T {
  const r = rows<T>(data)[0];
  if (!r) throw new StoreError(404, "not_found");
  return r;
}

const app = COLETIVO_APP_ID;

// ---- identity / moderation -------------------------------------------------

export type MeRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  moderator_handle: string | null;
};

export const me = async (tokenHash: string) =>
  one<MeRow>(await call("userbase_app_me", { p_token_hash: tokenHash, p_app: app }));

export const createChallenge = async (tokenHash: string, hiveHandle: string) =>
  one<{ challenge_id: string; message: string; expires_at: string }>(
    await call("userbase_app_moderator_challenge_create", {
      p_token_hash: tokenHash,
      p_app: app,
      p_hive_handle: hiveHandle,
    })
  );

export const getChallenge = async (tokenHash: string, challengeId: string) =>
  one<{ challenge_id: string; hive_handle: string; message: string; expires_at: string }>(
    await call("userbase_app_moderator_challenge_get", {
      p_token_hash: tokenHash,
      p_app: app,
      p_challenge_id: challengeId,
    })
  );

export const bindModerator = async (tokenHash: string, challengeId: string, publicKey: string) =>
  one<{ hive_handle: string }>(
    await call("userbase_app_moderator_bind", {
      p_token_hash: tokenHash,
      p_app: app,
      p_challenge_id: challengeId,
      p_public_key: publicKey,
    })
  );

// ---- posts -----------------------------------------------------------------

export type PostRow = {
  id: string;
  status: string;
  kind: string;
  /** 0043; absent on rows from an older DB = snap. */
  publication_type?: "snap" | "article";
  title: string | null;
  body: string;
  media: MediaItem[];
  context_kind: "instalacao" | "evento" | null;
  context_slug: string | null;
  created_at: string;
  reviewed_at: string | null;
  reject_reason: string | null;
  published_at: string | null;
  publish_author: string | null;
  publish_permlink: string | null;
  last_error_code: string | null;
  auto_approved?: boolean;
  author_handle?: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
  reviewed_by_hive_handle?: string | null;
  publish_attempts?: number;
  is_owner?: boolean;
  viewer_is_moderator?: boolean;
};

export const createPost = async (
  tokenHash: string,
  p: {
    idempotencyKey: string;
    requestHash: string;
    publicationType: "snap" | "article";
    kind: string;
    title: string | null;
    body: string;
    media: MediaItem[];
    context: ContextRef | null;
  }
) =>
  one<PostRow>(
    await call("userbase_app_post_create", {
      p_token_hash: tokenHash,
      p_app: app,
      p_idempotency_key: p.idempotencyKey,
      p_request_hash: p.requestHash,
      p_kind: p.kind,
      p_title: p.title,
      p_body: p.body,
      p_media: p.media,
      p_context_kind: p.context?.kind ?? null,
      p_context_slug: p.context?.slug ?? null,
      p_consent_publish: true,
      p_publication_type: p.publicationType,
    })
  );

export const reviewPost = async (tokenHash: string, postId: string, decision: "approve" | "reject", reason?: string) =>
  one<PostRow>(
    await call("userbase_app_post_review", {
      p_token_hash: tokenHash,
      p_app: app,
      p_post_id: postId,
      p_decision: decision,
      p_reject_reason: reason ?? null,
    })
  );

export const getPost = async (tokenHash: string, postId: string) =>
  one<PostRow>(await call("userbase_app_post_get", { p_token_hash: tokenHash, p_app: app, p_post_id: postId }));

export type Page = { before: string | null; beforeId: string | null; limit: number };

export const listMine = async (tokenHash: string, page: Page) =>
  rows<PostRow>(
    await call("userbase_app_post_list_mine", {
      p_token_hash: tokenHash,
      p_app: app,
      p_before_at: page.before,
      p_before_id: page.beforeId,
      p_limit: page.limit,
    })
  );

export const listQueue = async (tokenHash: string, status: string, page: Page) =>
  rows<PostRow>(
    await call("userbase_app_post_queue", {
      p_token_hash: tokenHash,
      p_app: app,
      p_status: status,
      p_before_at: page.before,
      p_before_id: page.beforeId,
      p_limit: page.limit,
    })
  );

export const listFeed = async (context: { kind: string | null; slug: string | null }, page: Page) =>
  rows<PostRow>(
    await call("userbase_app_feed", {
      p_app: app,
      p_context_kind: context.kind,
      p_context_slug: context.slug,
      p_before_at: page.before,
      p_before_id: page.beforeId,
      p_limit: page.limit,
    })
  );

/** Published post by id, public fields only (0043 userbase_app_post_public). */
export const getPublicPost = async (postId: string) =>
  one<PostRow>(await call("userbase_app_post_public", { p_app: app, p_post_id: postId }));

export const requeuePublish = async (tokenHash: string, postId: string) =>
  one<PostRow>(await call("userbase_app_post_publish_requeue", { p_token_hash: tokenHash, p_app: app, p_post_id: postId }));

// ---- worker side (service role, no session) --------------------------------

type DbPost = PostRow & {
  user_id: string;
  publish_parent_author?: string | null;
  publish_parent_permlink?: string | null;
  publish_claim_token: string | null;
  publish_signer_kind: "own_key" | "shared_default" | null;
  crosspost_queue_id: string | null;
};

function toPublishPost(r: DbPost): PostForPublish {
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    body: r.body || "",
    media: Array.isArray(r.media) ? r.media : [],
    context: r.context_kind && r.context_slug ? { kind: r.context_kind, slug: r.context_slug } : null,
    publish_author: r.publish_author,
    publish_permlink: r.publish_permlink || "",
    publish_parent_author: r.publish_parent_author ?? null,
    publish_parent_permlink: r.publish_parent_permlink ?? null,
    publication_type: r.publication_type === "article" ? "article" : "snap",
  };
}

export const publishStore: PublishStore = {
  async claim(postId) {
    const r = rows<DbPost>(
      await call("userbase_app_post_publish_claim", {
        p_post_id: postId,
        p_worker: "skatehive-api",
        p_lease_seconds: Math.round(LIMITS.publishLeaseMs / 1000),
        p_limit: 1,
      })
    )[0];
    if (!r || !r.publish_claim_token || !r.publish_permlink) return null;
    return { claimToken: r.publish_claim_token, post: toPublishPost(r) };
  },
  async reserve(postId, claimToken, target) {
    try {
      // 0041: reserves author + signer + snap parent atomically; on any change
      // the DB fails the post with target_changed (never republished elsewhere).
      const r = one<DbPost>(
        await call("userbase_app_post_publish_reserve_target", {
          p_post_id: postId,
          p_claim_token: claimToken,
          p_author: target.author,
          p_signer_kind: target.signerKind,
          p_parent_author: target.parentAuthor,
          p_parent_permlink: target.parentPermlink,
        })
      );
      if (r.status === "failed" && (r.last_error_code === "target_changed" || r.last_error_code === "legacy_target_unknown")) {
        return r.last_error_code;
      }
      return r.status === "publishing" ? "ok" : "lost";
    } catch (e) {
      if (e instanceof StoreError && e.status === 409) return "lost";
      throw e;
    }
  },
  async markLegacy(postId, claimToken, detail) {
    try {
      const r = one<DbPost>(
        await call("userbase_app_post_publish_mark_legacy", {
          p_post_id: postId,
          p_claim_token: claimToken,
          p_detail: detail.slice(0, 400),
        })
      );
      return r.status === "failed" ? "failed" : "lost";
    } catch (e) {
      if (e instanceof StoreError && e.status === 409) return "lost";
      throw e;
    }
  },
  async complete(postId, claimToken) {
    try {
      await call("userbase_app_post_publish_complete", {
        p_post_id: postId,
        p_claim_token: claimToken,
        p_ok: true,
        // Both always queued; the outbox worker skips what does not apply.
        p_followups: [...FOLLOWUP_KINDS],
      });
      return true;
    } catch (e) {
      if (e instanceof StoreError && e.status === 409) return false;
      throw e;
    }
  },
  async fail(postId, claimToken, errorCode, retryable) {
    try {
      const r = one<DbPost>(
        await call("userbase_app_post_publish_complete", {
          p_post_id: postId,
          p_claim_token: claimToken,
          p_ok: false,
          p_error_code: errorCode,
          p_retryable: retryable,
        })
      );
      return r.status === "approved" ? "approved" : "failed";
    } catch (e) {
      if (e instanceof StoreError && e.status === 409) return "lost";
      throw e;
    }
  },
};

// ---- outbox (post-publish follow-ups) -------------------------------------

type OutboxRow = Omit<OutboxItem, "media" | "body"> & { media: MediaItem[] | null; body: string | null };

export async function claimOutbox(kind: FollowupKind, limit: number): Promise<OutboxItem[]> {
  const r = rows<OutboxRow>(
    await call("userbase_app_post_outbox_claim", {
      p_kind: kind,
      p_worker: "skatehive-api",
      p_lease_seconds: 120,
      p_limit: limit,
    })
  );
  return r
    .filter((x) => x.publish_author && x.publish_permlink && x.publish_signer_kind)
    .map((x) => ({ ...x, body: x.body || "", media: Array.isArray(x.media) ? x.media : [] }));
}

export async function completeOutbox(
  item: OutboxItem,
  ok: boolean,
  errorCode?: string,
  result?: Record<string, unknown>
): Promise<void> {
  await call("userbase_app_post_outbox_complete", {
    p_outbox_id: item.outbox_id,
    p_claim_token: item.claim_token,
    p_ok: ok,
    p_error_code: ok ? null : errorCode ?? "failed",
    p_result: result ?? null,
  });
}

export async function linkCrosspost(postId: string, queueId: string): Promise<void> {
  await call("userbase_app_post_link_crosspost", { p_post_id: postId, p_crosspost_queue_id: queueId });
}
