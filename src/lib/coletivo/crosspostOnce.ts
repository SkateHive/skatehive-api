// At most one Instagram curation request per published Coletivo post, ever.
// The queue's unique index only covers ACTIVE rows, so after a curator rejects
// (or publishing fails) a blind replay could open a new request. Before
// enqueueing we therefore look for ANY row for target+author+permlink, in any
// status, and reuse it. Combined with the post's own crosspost_queue_id link and
// the outbox's single claim per post, a crash between enqueue and link can only
// re-link the same row, never reopen the request.

export type CrosspostLookup = (target: "instagram", author: string, permlink: string) => Promise<{ id: string; status: string } | null>;

export async function enqueueCrosspostOnce(
  item: { publish_author: string; publish_permlink: string },
  deps: { findAny: CrosspostLookup; enqueue: () => Promise<string> }
): Promise<{ id: string; reused: boolean }> {
  const existing = await deps.findAny("instagram", item.publish_author, item.publish_permlink);
  if (existing) return { id: existing.id, reused: true };
  return { id: await deps.enqueue(), reused: false };
}
