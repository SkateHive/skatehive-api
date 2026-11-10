import type { MediaItem } from "./validation";

// Post-publish follow-ups, driven by the DB outbox (userbase_app_post_outbox,
// created in the same transaction that marks a post published). Each kind is
// claimed with a lease, retried with backoff by the DB, and NEVER broadcasts
// to Hive or touches the post's publish state, so it can be re-run at will.
//
//  - soft_post: attribution row in userbase_soft_posts for shared-account posts
//    (unique author+permlink: replays are no-ops); own-key posts are skipped.
//  - instagram_enqueue: one Skatehive curation request for posts with media
//    (active unique index on target+author+permlink), linked back to the post.

export const FOLLOWUP_KINDS = ["soft_post", "instagram_enqueue"] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export type OutboxItem = {
  outbox_id: string;
  claim_token: string;
  kind: FollowupKind;
  post_id: string;
  post_user_id: string;
  publish_author: string;
  publish_permlink: string;
  publish_signer_kind: "own_key" | "shared_default";
  title: string | null;
  body: string;
  media: MediaItem[];
};

export type OutboxDeps = {
  claim: (kind: FollowupKind, limit: number) => Promise<OutboxItem[]>;
  complete: (item: OutboxItem, ok: boolean, errorCode?: string, result?: Record<string, unknown>) => Promise<void>;
  recordSoftPost: (item: OutboxItem) => Promise<void>;
  /** Queue row id (the existing one on replay). */
  enqueueCrosspost: (item: OutboxItem) => Promise<string>;
  linkCrosspost: (postId: string, queueId: string) => Promise<void>;
  now?: () => number;
};

export type DrainResult = { claimed: number; done: number; skipped: number; errors: number; stoppedByDeadline: boolean };

export type DrainOptions = {
  /** Max items per kind in this run. */
  limitPerKind: number;
  /** Budget for STARTING work. Not a hard wall: a run can overrun by at most
   * one item's callTimeoutMs (plus its completion report). */
  deadlineMs: number;
  /** Timeout for each external call (handler, report). */
  callTimeoutMs?: number;
};

class TimeoutError extends Error {
  code = "timeout";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function handle(item: OutboxItem, deps: OutboxDeps): Promise<"done" | "skipped"> {
  if (item.kind === "soft_post") {
    if (item.publish_signer_kind !== "shared_default") return "skipped";
    await deps.recordSoftPost(item);
    return "done";
  }
  if (!item.media.length) return "skipped";
  // enqueueCrosspost dedupes against ANY existing queue row (crosspostOnce.ts),
  // so a timed-out attempt that actually landed is reused on the next run.
  const queueId = await deps.enqueueCrosspost(item);
  await deps.linkCrosspost(item.post_id, queueId);
  return "done";
}

/**
 * Process due follow-ups ONE claim at a time, checking the budget before each
 * claim, so a run never holds more than one lease and stops starting new work
 * once the budget is spent.
 */
export async function drainOutbox(deps: OutboxDeps, opts: DrainOptions): Promise<DrainResult> {
  const now = deps.now ?? Date.now;
  const callTimeout = opts.callTimeoutMs ?? 5000;
  const stopAt = now() + opts.deadlineMs;
  const r: DrainResult = { claimed: 0, done: 0, skipped: 0, errors: 0, stoppedByDeadline: false };

  for (const kind of FOLLOWUP_KINDS) {
    for (let n = 0; n < opts.limitPerKind; n++) {
      if (now() >= stopAt) {
        r.stoppedByDeadline = true;
        return r;
      }
      const [item] = await withTimeout(deps.claim(kind, 1), callTimeout);
      if (!item) break;
      r.claimed += 1;
      try {
        const outcome = await withTimeout(handle(item, deps), callTimeout);
        await withTimeout(
          deps.complete(item, true, undefined, outcome === "skipped" ? { skipped: true } : undefined),
          callTimeout
        );
        if (outcome === "skipped") r.skipped += 1;
        else r.done += 1;
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        await withTimeout(
          deps.complete(item, false, typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : `${kind}_failed`),
          callTimeout
        ).catch(() => {});
        r.errors += 1;
      }
    }
  }
  return r;
}
