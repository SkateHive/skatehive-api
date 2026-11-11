import type { PostRow } from "./store";
import { encodeCursor } from "./cursor";

// Response shapes. The public feed never carries moderation internals
// (reject reason, error codes, reviewer) and nothing here ever carries email.

const hive = (r: PostRow) =>
  r.publish_author && r.publish_permlink && r.status === "published"
    ? { author: r.publish_author, permlink: r.publish_permlink, url: `https://skatehive.app/post/${r.publish_author}/${r.publish_permlink}` }
    : null;

const publicationType = (r: PostRow) => (r.publication_type === "article" ? "article" : "snap");

/** Cover = the first PHOTO in media (no separate field), or null. */
const cover = (r: PostRow) => (Array.isArray(r.media) ? r.media.find((m) => m.type === "image")?.url ?? null : null);

const context = (r: PostRow) => (r.context_kind && r.context_slug ? { kind: r.context_kind, slug: r.context_slug } : null);

const author = (r: PostRow) =>
  r.author_handle !== undefined
    ? { handle: r.author_handle ?? null, display_name: r.author_display_name ?? null, avatar_url: r.author_avatar_url ?? null }
    : undefined;

/** Owner / moderator view. */
export function submissionView(r: PostRow) {
  return {
    id: r.id,
    status: r.status,
    publication_type: publicationType(r),
    kind: r.kind,
    title: r.title,
    cover: cover(r),
    body: r.body,
    media: r.media,
    context: context(r),
    author: author(r),
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    reject_reason: r.reject_reason,
    published_at: r.published_at,
    auto_approved: r.auto_approved ?? undefined,
    hive: hive(r),
    last_error_code: r.last_error_code,
  };
}

/** Moderator queue view adds who reviewed and how many publish attempts. */
export function queueView(r: PostRow) {
  return { ...submissionView(r), reviewed_by: r.reviewed_by_hive_handle ?? null, publish_attempts: r.publish_attempts ?? 0 };
}

/** Public feed item: published only, no moderation internals. */
export function feedView(r: PostRow) {
  return {
    id: r.id,
    publication_type: publicationType(r),
    kind: r.kind,
    title: r.title,
    cover: cover(r),
    body: r.body,
    media: r.media,
    context: context(r),
    author: author(r),
    published_at: r.published_at,
    hive: hive({ ...r, status: "published" }),
  };
}

export function nextCursor(items: PostRow[], limit: number, ts: (r: PostRow) => string | null): string | null {
  if (items.length < limit) return null;
  const last = items[items.length - 1];
  const t = ts(last);
  return t ? encodeCursor({ ts: t, id: last.id }) : null;
}
