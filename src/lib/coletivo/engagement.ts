import { COLETIVO_APP_ID, hiveParentTag } from "./config";

// Read-only engagement (positive votes, replies) for PUBLISHED Coletivo posts,
// straight from Hive RPC on the post's own author/permlink (never the
// @peak.snaps container). Pure: the chain reader and the clock are injected.
//
// Semantics, checked against real threads on 2026-11-10:
//  - children (get_content) = TOTAL replies in the subtree (direct + nested):
//    post.children == direct replies + sum(direct[i].children);
//  - get_content_replies = FIRST-LEVEL replies only;
//  - votes_up = distinct voters with percent > 0 (removed 0 and downvotes
//    excluded); a malformed vote list is "unknown", never 0.

export type PublishedTarget = {
  id: string;
  publish_author: string;
  publish_permlink: string;
  /** null for the legacy root (blog) post published before 0041. */
  publish_parent_author: string | null;
  publish_parent_permlink: string | null;
};

export type ChainReader = {
  getContent: (author: string, permlink: string, signal?: AbortSignal) => Promise<unknown>;
  getReplies: (author: string, permlink: string, signal?: AbortSignal) => Promise<unknown>;
};

export type Unavailable = { status: "unavailable"; code: "chain_unavailable" | "chain_mismatch" | "timeout" | "malformed" };

export type Engagement =
  | { status: "ok"; votes_up: number; comments_total: number; updated_at: string }
  | Unavailable;

const BODY_MAX = 10_000;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Safe integer from a number or an integer string; null otherwise. */
function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^-?\d{1,15}$/.test(v.trim())) return Number(v);
  return null;
}
/** Non-negative integer count, or null. */
function count(v: unknown): number | null {
  const n = int(v);
  return n !== null && n >= 0 ? n : null;
}

/** Distinct voters with percent > 0; null when the list is malformed. */
export function countPositiveVotes(activeVotes: unknown): number | null {
  if (!Array.isArray(activeVotes)) return null;
  const up = new Set<string>();
  for (const v of activeVotes) {
    const voter = (v as { voter?: unknown })?.voter;
    const percent = int((v as { percent?: unknown })?.percent);
    // Hive vote percent is -10000..10000 (100.00%).
    if (typeof voter !== "string" || !voter || percent === null || percent < -10000 || percent > 10000) return null;
    if (percent > 0) up.add(voter);
  }
  return up.size;
}

/** Hive dates come without a timezone but are UTC. */
export function hiveDateToIso(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The chain post must be THIS submission at its persisted destination:
 * author, permlink, json_metadata.coletivoxv.submission_id, and the parent
 * (the saved snap parent, or for the legacy blog post the community root).
 */
export function verifyChainPost(raw: unknown, t: PublishedTarget, env: NodeJS.ProcessEnv = process.env): "ok" | "mismatch" {
  const c = raw as {
    author?: unknown; permlink?: unknown; parent_author?: unknown; parent_permlink?: unknown; json_metadata?: unknown;
  } | null;
  if (!c || c.author !== t.publish_author || c.permlink !== t.publish_permlink) return "mismatch";
  let sid: unknown = null;
  try {
    sid = JSON.parse(typeof c.json_metadata === "string" ? c.json_metadata : "{}")?.[COLETIVO_APP_ID]?.submission_id;
  } catch {
    sid = null;
  }
  if (sid !== t.id) return "mismatch";
  const expectedParent =
    t.publish_parent_author !== null
      ? { a: t.publish_parent_author, p: t.publish_parent_permlink }
      : { a: "", p: hiveParentTag(env) };
  if (c.parent_author !== expectedParent.a || c.parent_permlink !== expectedParent.p) return "mismatch";
  return "ok";
}

export async function readEngagement(
  t: PublishedTarget,
  reader: ChainReader,
  opts: { timeoutMs: number; now?: () => Date; signal?: AbortSignal }
): Promise<Engagement> {
  let raw: unknown;
  try {
    raw = await withTimeout(reader.getContent(t.publish_author, t.publish_permlink, opts.signal), opts.timeoutMs);
  } catch (e) {
    return { status: "unavailable", code: (e as { code?: unknown })?.code === "timeout" ? "timeout" : "chain_unavailable" };
  }
  if (verifyChainPost(raw, t) !== "ok") return { status: "unavailable", code: "chain_mismatch" };
  const c = raw as { active_votes?: unknown; children?: unknown };
  const votes = countPositiveVotes(c.active_votes);
  const children = count(c.children);
  if (votes === null || children === null) return { status: "unavailable", code: "malformed" };
  return { status: "ok", votes_up: votes, comments_total: children, updated_at: (opts.now?.() ?? new Date()).toISOString() };
}

/**
 * Run tasks with bounded concurrency and ONE global deadline. The deadline is
 * checked BEFORE each new task starts, so nothing new is launched once it has
 * passed; in-flight workers get an aborted signal (and are reported as
 * timeout if they have not finished).
 */
export async function boundedAll<T, R>(
  items: T[],
  worker: (item: T, signal: AbortSignal) => Promise<R>,
  opts: { concurrency: number; deadlineMs: number; onTimeout: (item: T) => R }
): Promise<{ results: R[]; started: number }> {
  const results: (R | undefined)[] = new Array(items.length);
  const ctrl = new AbortController();
  let next = 0;
  let started = 0;
  const run = async () => {
    while (!ctrl.signal.aborted && next < items.length) {
      const i = next++;
      started++;
      try {
        const r = await worker(items[i], ctrl.signal);
        if (!ctrl.signal.aborted) results[i] = r;
      } catch {
        /* reported as timeout below */
      }
    }
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve();
    }, opts.deadlineMs);
  });
  await Promise.race([Promise.all(Array.from({ length: Math.min(opts.concurrency, items.length) }, run)), deadline]);
  clearTimeout(timer!);
  ctrl.abort(); // no straggler starts anything after we return
  return { results: items.map((it, i) => (results[i] === undefined ? opts.onTimeout(it) : (results[i] as R))), started };
}

// ---- comments ----------------------------------------------------------

export type CommentItem = {
  id: string; // author/permlink
  author: { handle: string; avatar_url: string };
  created_at: string;
  body: string;
  body_truncated: boolean;
  replies: number; // total under this comment (children)
  votes_up: number | null;
  low_score: boolean;
};

export const MAX_DIRECT_REPLIES = 1000;

export type CommentsPage =
  | {
      status: "ok";
      total_replies: number;
      direct_count: number;
      items: CommentItem[];
      next_cursor: string | null;
      /** true when there are more direct replies than the API serves: use thread_url. */
      partial: boolean;
      thread_url: string;
    }
  | Unavailable;

type CursorKey = [string, string, string]; // created_at, author, permlink

export function encodeCommentCursor(k: CursorKey): string {
  return Buffer.from(JSON.stringify(k)).toString("base64url");
}
export function decodeCommentCursor(raw: string | null): CursorKey | null | "invalid" {
  if (!raw) return null;
  if (raw.length > 400) return "invalid";
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "string" && x.length <= 300)) return "invalid";
    return v as CursorKey;
  } catch {
    return "invalid";
  }
}

const cmp = (a: CursorKey, b: CursorKey) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

function toComment(r: unknown, parent: PublishedTarget): CommentItem | null {
  const c = r as {
    author?: unknown; permlink?: unknown; created?: unknown; body?: unknown; children?: unknown;
    active_votes?: unknown; net_rshares?: unknown; parent_author?: unknown; parent_permlink?: unknown;
  };
  const created = hiveDateToIso(c?.created);
  const children = count(c?.children);
  if (typeof c?.author !== "string" || typeof c?.permlink !== "string" || !created || children === null) return null;
  // Direct replies of THIS post only.
  if (c.parent_author !== parent.publish_author || c.parent_permlink !== parent.publish_permlink) return null;
  const body = typeof c.body === "string" ? c.body : "";
  const net = int(c.net_rshares);
  return {
    id: `${c.author}/${c.permlink}`,
    author: { handle: c.author, avatar_url: `https://images.hive.blog/u/${encodeURIComponent(c.author)}/avatar` },
    created_at: created,
    body: body.slice(0, BODY_MAX),
    body_truncated: body.length > BODY_MAX,
    replies: children,
    votes_up: countPositiveVotes(c.active_votes),
    low_score: net !== null && net < 0,
  };
}

export async function readComments(
  t: PublishedTarget,
  reader: ChainReader,
  opts: { timeoutMs: number; limit: number; cursor: CursorKey | null; signal?: AbortSignal }
): Promise<CommentsPage> {
  let raw: unknown;
  let replies: unknown;
  try {
    [raw, replies] = await withTimeout(
      Promise.all([
        reader.getContent(t.publish_author, t.publish_permlink, opts.signal),
        reader.getReplies(t.publish_author, t.publish_permlink, opts.signal),
      ]),
      opts.timeoutMs
    );
  } catch (e) {
    return { status: "unavailable", code: (e as { code?: unknown })?.code === "timeout" ? "timeout" : "chain_unavailable" };
  }
  if (verifyChainPost(raw, t) !== "ok") return { status: "unavailable", code: "chain_mismatch" };
  const total = count((raw as { children?: unknown }).children);
  if (!Array.isArray(replies) || total === null) return { status: "unavailable", code: "malformed" };
  // Direct replies can never exceed the subtree total.
  if (replies.length > total) return { status: "unavailable", code: "malformed" };
  const partial = replies.length > MAX_DIRECT_REPLIES;
  const parsed = replies.slice(0, MAX_DIRECT_REPLIES).map((r) => toComment(r, t));
  // A malformed or foreign reply makes the list untrustworthy: never drop it
  // silently (that could turn a broken list into "no comments").
  if (parsed.some((c) => c === null)) return { status: "unavailable", code: "malformed" };
  const all = (parsed as CommentItem[]).sort((a, b) =>
    cmp([a.created_at, a.author.handle, a.id], [b.created_at, b.author.handle, b.id])
  );
  const after = opts.cursor ? all.filter((c) => cmp([c.created_at, c.author.handle, c.id], opts.cursor!) > 0) : all;
  const page = after.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    status: "ok",
    total_replies: total,
    direct_count: replies.length,
    items: page,
    next_cursor: after.length > page.length && last ? encodeCommentCursor([last.created_at, last.author.handle, last.id]) : null,
    partial,
    thread_url: `https://skatehive.app/post/${t.publish_author}/${t.publish_permlink}`,
  };
}

// ---- bounded TTL cache (per instance) -----------------------------------

export class TtlCache<V> {
  private map = new Map<string, { v: V; at: number }>();
  constructor(private max: number, private ttlMs: number, private now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, { v, at: this.now() });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}
