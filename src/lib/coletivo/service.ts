import { HiveClient } from "@/app/utils/hive/hiveUtils";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { resolveSigner, broadcastComment } from "@/lib/userbase/posting";
import { getSafeUserIdentifier } from "@/lib/userbase/safeUser";
import { CROSSPOST_QUEUE_TABLE, enqueueCrossPost, type InstagramQueuePayload } from "@/lib/crosspost/queue";
import { enqueueCrosspostOnce } from "./crosspostOnce";
import { buildInstagramCaption } from "@/lib/instagram/caption";
import { COLETIVO_APP_ID, isPublishEnabled } from "./config";
import { publishPost, type ChainPost, type PublishOutcome } from "./publisher";
import { drainOutbox, type DrainResult, type OutboxItem } from "./sideEffects";
import { claimOutbox, completeOutbox, linkCrosspost, publishStore } from "./store";

// Production wiring of the publisher and the side-effect outbox. Nothing here
// runs a chain write unless COLETIVO_HIVE_PUBLISH_ENABLED=1.

export async function getChainPost(author: string, permlink: string): Promise<ChainPost> {
  const c = (await HiveClient.database.call("get_content", [author, permlink])) as {
    author?: string;
    permlink?: string;
    json_metadata?: string;
  } | null;
  if (!c || !c.author) return null;
  let submissionId: string | null = null;
  try {
    const meta = JSON.parse(c.json_metadata || "{}");
    const id = meta?.[COLETIVO_APP_ID]?.submission_id;
    submissionId = typeof id === "string" ? id : null;
  } catch {
    submissionId = null;
  }
  return { author: c.author, permlink: c.permlink || "", submissionId };
}

export function permalinkUrl(author: string, permlink: string): string {
  return `https://skatehive.app/post/${author}/${permlink}`;
}

async function recordSoftPost(item: OutboxItem): Promise<void> {
  if (!supabaseAdmin) throw new Error("unavailable");
  const now = new Date().toISOString();
  // Unique (author, permlink): replays are no-ops.
  const { error } = await supabaseAdmin.from("userbase_soft_posts").upsert(
    {
      user_id: item.post_user_id,
      author: item.publish_author,
      permlink: item.publish_permlink,
      title: item.title || "",
      type: "post",
      status: "broadcasted",
      safe_user: getSafeUserIdentifier(item.post_user_id),
      metadata: { app: COLETIVO_APP_ID, submission_id: item.post_id },
      created_at: now,
      updated_at: now,
      broadcasted_at: now,
    },
    { onConflict: "author,permlink", ignoreDuplicates: true }
  );
  if (error) throw new Error("soft_post_failed");
}

/** Any queue row for this post, whatever its status (durable dedupe). */
async function findAnyCrosspost(target: "instagram", author: string, permlink: string) {
  if (!supabaseAdmin) throw new Error("unavailable");
  const { data, error } = await supabaseAdmin
    .from(CROSSPOST_QUEUE_TABLE)
    .select("id, status")
    .eq("target", target)
    .eq("hive_author", author)
    .eq("hive_permlink", permlink)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error("crosspost_lookup_failed");
  return (data?.[0] as { id: string; status: string } | undefined) ?? null;
}

async function enqueueInstagram(post: OutboxItem): Promise<string> {
  const r = await enqueueCrosspostOnce(post, { findAny: findAnyCrosspost, enqueue: () => enqueueInstagramNew(post) });
  return r.id;
}

async function enqueueInstagramNew(post: OutboxItem): Promise<string> {
  const video = post.media.find((m) => m.type === "video");
  const image = post.media.find((m) => m.type === "image");
  if (!video && !image) throw new Error("no_media");
  const link = permalinkUrl(post.publish_author, post.publish_permlink);
  const payload: InstagramQueuePayload = {
    caption: buildInstagramCaption({
      title: post.title || undefined,
      body: post.body,
      hiveAuthor: post.publish_author,
      permalinkUrl: link,
    }),
    collaborators: [],
    image_url: video ? (video.type === "video" && video.poster) || null : image!.url,
    video_url: video ? video.url : null,
    ig_media_type: video ? "REELS" : "IMAGE",
    permalink_url: link,
    title: post.title || undefined,
    tags: [COLETIVO_APP_ID],
  };
  const r = await enqueueCrossPost({
    supabase: supabaseAdmin,
    target: "instagram",
    userId: post.post_user_id,
    requestedByHandle: post.publish_author,
    hiveAuthor: post.publish_author,
    hivePermlink: post.publish_permlink,
    payload,
  });
  if (!r.ok) throw new Error("crosspost_failed");
  return r.id;
}

const outboxDeps = {
  claim: claimOutbox,
  complete: completeOutbox,
  recordSoftPost,
  enqueueCrosspost: enqueueInstagram,
  linkCrosspost,
};

/** Process due follow-ups (bounded). Never broadcasts to Hive. */
export function drainFollowups(opts: { limitPerKind: number; deadlineMs: number; callTimeoutMs?: number } = { limitPerKind: 10, deadlineMs: 8000, callTimeoutMs: 5000 }): Promise<DrainResult> {
  return drainOutbox(outboxDeps, opts);
}

/** Publish one approved post, then its side effects. Safe to call repeatedly. */
function publishDeps() {
  return {
    store: publishStore,
    enabled: isPublishEnabled(),
    resolveSigner,
    safeUserId: getSafeUserIdentifier,
    getChainPost,
    broadcast: (signer: Parameters<typeof broadcastComment>[0], c: import("./publisher").HiveComment) =>
      broadcastComment(signer, {
        parentAuthor: c.parentAuthor,
        parentPermlink: c.parentPermlink,
        permlink: c.permlink,
        title: c.title,
        body: c.body,
        jsonMetadata: c.jsonMetadata,
      }),
  };
}

export async function runPublishFlow(postId: string): Promise<PublishOutcome> {
  let outcome: PublishOutcome;
  try {
    outcome = await publishPost(postId, publishDeps());
  } catch (e) {
    console.error("[coletivo/publish] flow error", (e as { code?: string })?.code || "unknown");
    return { status: "retryable", code: "internal_error" };
  }
  if (outcome.status === "published") {
    await drainFollowups({ limitPerKind: 5, deadlineMs: 5000, callTimeoutMs: 5000 }).catch(() => null);
  }
  return outcome;
}

export type ResumeReport = { published: number; retryable: number; failed: number; disabled: boolean; followups: DrainResult | null };

/**
 * Recovery after a crash/timeout (moderator action or a guarded cron): pick up
 * approved posts and expired publish leases (the DB claim decides; failed posts
 * are NOT requeued here), then drain due follow-ups, including for posts that
 * were already published. Bounded by count and a SOFT time budget (new work
 * stops at the deadline; in-flight calls have their own timeouts).
 */
export async function resumeColetivo(opts = { maxPublishes: 5, deadlineMs: 20000 }): Promise<ResumeReport> {
  const stopAt = Date.now() + opts.deadlineMs;
  const report: ResumeReport = { published: 0, retryable: 0, failed: 0, disabled: !isPublishEnabled(), followups: null };
  for (let i = 0; i < opts.maxPublishes && !report.disabled && Date.now() < stopAt; i++) {
    let o: PublishOutcome;
    try {
      o = await publishPost(null, publishDeps());
    } catch {
      break;
    }
    if (o.status === "published") report.published += 1;
    else if (o.status === "retryable") report.retryable += 1;
    else if (o.status === "failed") report.failed += 1;
    else break; // busy (nothing due) or disabled
  }
  const left = Math.max(0, stopAt - Date.now());
  // Soft budget: starting stops at the deadline; one in-flight item may overrun by its call timeout.
  if (left > 1000) report.followups = await drainFollowups({ limitPerKind: 10, deadlineMs: left - 500, callTimeoutMs: 5000 }).catch(() => null);
  return report;
}
