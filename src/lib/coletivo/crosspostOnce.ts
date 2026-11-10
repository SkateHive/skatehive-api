// Idempotent Instagram curation request for a published Coletivo post.
//
// How: before enqueueing, look up ANY queue row for target+author+permlink (in
// any status) and reuse it; otherwise enqueue, where the queue's unique index on
// ACTIVE rows rejects a concurrent duplicate (enqueueCrossPost then returns the
// existing row). The post keeps the id in crosspost_queue_id, and the outbox
// holds one claim per (post, kind) at a time.
//
// This covers the normal crash/retry cases (crash between enqueue and link,
// timeout that actually landed, replay after a curator rejected).
// Residual, documented: it is NOT a single-transaction guarantee. Two workers
// that both see "no row" at the same moment, where the first row is then
// moved to rejected/failed before the second insert, could still produce a
// second request. An atomic SQL service (lookup + insert + link in one
// transaction) would close that window.

export type CrosspostLookup = (target: "instagram", author: string, permlink: string) => Promise<{ id: string; status: string } | null>;

export async function enqueueCrosspostOnce(
  item: { publish_author: string; publish_permlink: string },
  deps: { findAny: CrosspostLookup; enqueue: () => Promise<string> }
): Promise<{ id: string; reused: boolean }> {
  const existing = await deps.findAny("instagram", item.publish_author, item.publish_permlink);
  if (existing) return { id: existing.id, reused: true };
  return { id: await deps.enqueue(), reused: false };
}
