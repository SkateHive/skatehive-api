import crypto from "crypto";
import { LIMITS } from "./config";

// Submission input validation. Only content fields are read from the client;
// status, author, app, approval and permlink are never taken from the body.

export type MediaItem =
  | { type: "image"; url: string }
  | { type: "video"; url: string; poster?: string };

export type ContextRef = { kind: "instalacao" | "evento"; slug: string };

export type PublicationType = "snap" | "article";

export type SubmissionInput = {
  publicationType: PublicationType;
  title: string | null;
  body: string;
  media: MediaItem[];
  context: ContextRef | null;
  kind: "text" | "photo" | "video";
};

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; error: string };

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
// CIDv0 (base58btc, Qm...) or CIDv1 base32 (b...).
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;

export const IPFS_GATEWAY_HOST = "ipfs.skatehive.app";
export const HIVE_IMAGES_HOST = "images.hive.blog";

function fail(code: string, error: string): { ok: false; code: string; error: string } {
  return { ok: false, code, error };
}

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}

/** https://ipfs.skatehive.app/ipfs/<CID> exactly (no query, no fragment, no subpath). */
export function isGatewayCidUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  if (!u || u.hostname !== IPFS_GATEWAY_HOST || u.search || u.hash) return false;
  const m = u.pathname.match(/^\/ipfs\/([^/]+)$/);
  return !!m && CID_RE.test(m[1]);
}

/** An image already on images.hive.blog (returned by our own image upload). */
export function isHiveImageUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  return !!u && u.hostname === HIVE_IMAGES_HOST && u.pathname.length > 1 && !u.hash;
}

function parseMedia(raw: unknown): Parsed<MediaItem[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail("invalid_media", "media must be a list");
  if (raw.length > LIMITS.mediaMax) return fail("invalid_media", `At most ${LIMITS.mediaMax} media items`);
  const out: MediaItem[] = [];
  for (const item of raw) {
    const type = item?.type;
    if (type === "image") {
      if (!isHiveImageUrl(item.url)) return fail("invalid_media", "Image must come from the upload endpoint");
      out.push({ type: "image", url: String(item.url) });
    } else if (type === "video") {
      if (!isGatewayCidUrl(item.url)) return fail("invalid_media", "Video must be an ipfs.skatehive.app/ipfs/<CID> URL");
      const poster = item.poster;
      if (poster !== undefined && poster !== null && !isHiveImageUrl(poster) && !isGatewayCidUrl(poster)) {
        return fail("invalid_media", "Invalid video poster URL");
      }
      out.push(poster ? { type: "video", url: String(item.url), poster: String(poster) } : { type: "video", url: String(item.url) });
    } else {
      return fail("invalid_media", "Media type must be image or video");
    }
  }
  if (out.filter((m) => m.type === "video").length > LIMITS.videosMax) {
    return fail("invalid_media", `At most ${LIMITS.videosMax} video`);
  }
  return { ok: true, value: out };
}

function parseContext(raw: unknown): Parsed<ContextRef | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const kind = (raw as any)?.kind;
  const slug = (raw as any)?.slug;
  if ((kind !== "instalacao" && kind !== "evento") || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return fail("invalid_context", "context must be {kind:'instalacao'|'evento', slug}");
  }
  return { ok: true, value: { kind, slug } };
}

export function parseSubmissionInput(raw: unknown): Parsed<SubmissionInput> {
  if (!raw || typeof raw !== "object") return fail("invalid_body", "JSON body required");
  const b = raw as Record<string, unknown>;
  if (b.consent_publish !== true) {
    return fail("consent_required", "consent_publish must be true to publish on your behalf");
  }
  // Explicit field, never inferred from media; missing = snap (old clients).
  const pt = b.publication_type;
  if (pt !== undefined && pt !== null && pt !== "snap" && pt !== "article") {
    return fail("invalid_publication_type", "publication_type must be snap or article");
  }
  const publicationType: PublicationType = pt === "article" ? "article" : "snap";
  if (b.body !== undefined && b.body !== null && typeof b.body !== "string") {
    return fail("invalid_body", "body must be text");
  }
  const body = typeof b.body === "string" ? b.body.trim() : "";
  const bodyMax = publicationType === "article" ? LIMITS.articleBodyMax : LIMITS.bodyMax;
  if (body.length > bodyMax) return fail("invalid_body", `body must be up to ${bodyMax} chars`);
  let title: string | null = null;
  if (b.title !== undefined && b.title !== null) {
    if (typeof b.title !== "string" || b.title.trim().length > LIMITS.titleMax) {
      return fail("invalid_title", `title must be up to ${LIMITS.titleMax} chars`);
    }
    title = b.title.trim() || null;
  }
  if (publicationType === "article") {
    if (!title) return fail("title_required", `An article needs a title (1..${LIMITS.titleMax} chars)`);
    if (!body) return fail("invalid_body", `An article needs a body (1..${LIMITS.articleBodyMax} chars)`);
  }
  const media = parseMedia(b.media);
  if (!media.ok) return media;
  const context = parseContext(b.context);
  if (!context.ok) return context;
  // Snap: text OR media (a caption is optional when there is media).
  if (!body && media.value.length === 0) return fail("empty_submission", "Send text, a photo or a video");
  const kind = media.value.some((m) => m.type === "video")
    ? "video"
    : media.value.length
    ? "photo"
    : "text";
  return { ok: true, value: { publicationType, title, body, media: media.value, context: context.value, kind } };
}

/** Stable hash of the normalized content, to detect idempotency-key reuse. */
export function requestHash(input: SubmissionInput): string {
  // Snap: exactly the pre-article canonical form, so retries of requests made
  // before this change still match. Article: prefixed, so the same key with a
  // different type is a conflict.
  const base = [input.title, input.body, input.media, input.context];
  const canonical = JSON.stringify(input.publicationType === "article" ? ["article", ...base] : base);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,128}$/;
export function parseIdempotencyKey(raw: string | null): string | null {
  return raw && IDEMPOTENCY_RE.test(raw) ? raw : null;
}

export function parseRejectReason(raw: unknown): Parsed<string> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason || reason.length > LIMITS.rejectReasonMax) {
    return fail("invalid_reason", `reason must be 1..${LIMITS.rejectReasonMax} chars`);
  }
  return { ok: true, value: reason };
}
