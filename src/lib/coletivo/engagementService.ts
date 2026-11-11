import { HIVE_RPC_NODES } from "@/app/utils/hive/hiveUtils";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { COLETIVO_APP_ID } from "./config";
import { StoreError } from "./store";
import { hiveRpc } from "./hiveRpc";
import { TtlCache, type ChainReader, type CommentsPage, type Engagement, type PublishedTarget } from "./engagement";

// Production wiring for read-only engagement. Only caches successful reads of
// PUBLISHED content; failures are never cached and never turned into zeros.

// Bounded fetch (no background retries): 2 nodes max, 4s each, 3 MiB body cap,
// cancelled by the caller's signal (request / batch deadline).
const rpc = (method: string, params: unknown[], signal?: AbortSignal) =>
  hiveRpc(`condenser_api.${method}`, params, { nodes: HIVE_RPC_NODES, maxNodes: 2, perNodeTimeoutMs: 4000, maxBytes: 3 * 1024 * 1024, signal });

export const chainReader: ChainReader = {
  getContent: (a, p, signal) => rpc("get_content", [a, p], signal),
  getReplies: (a, p, signal) => rpc("get_content_replies", [a, p], signal),
};

export const engagementCache = new TtlCache<Extract<Engagement, { status: "ok" }>>(500, 30_000);
// Raw (content, replies) pairs can be up to ~3 MiB each: few entries and a
// total byte budget (approximate JSON size) keep memory bounded.
export const commentsCache = new TtlCache<{ raw: unknown; replies: unknown }>(20, 30_000, Date.now, {
  maxBytes: 8 * 1024 * 1024,
  sizeOf: (v) => JSON.stringify(v).length,
});

/**
 * Persisted destinations of the PUBLISHED coletivoxv posts among `ids`
 * (service role read). Unknown or unpublished ids are simply absent. A DB
 * failure throws (-> 503), it never looks like "not found".
 */
export async function publishedTargets(ids: string[]): Promise<Map<string, PublishedTarget>> {
  if (!supabaseAdmin) throw new StoreError(503, "unavailable");
  const { data, error } = await supabaseAdmin
    .from("userbase_app_posts")
    .select("id, publish_author, publish_permlink, publish_parent_author, publish_parent_permlink")
    .eq("app", COLETIVO_APP_ID)
    .eq("status", "published")
    .in("id", ids)
    .abortSignal(AbortSignal.timeout(5000)); // the request never hangs on the DB
  if (error) throw new StoreError(503, "unavailable");
  const out = new Map<string, PublishedTarget>();
  for (const r of (data || []) as PublishedTarget[]) {
    if (r.publish_author && r.publish_permlink) out.set(r.id, r);
  }
  return out;
}

export type { CommentsPage };
