// Snap publishing with an authoritative daily ledger (skatehive3.0 migration
// 0044: userbase_whatsapp_snap_reserve / _settle). All I/O is injected.
//
//   reserve (atomic, per-user lock; UB429 when the day is full)
//     -> broadcast
//        ok      -> settle 'published' (best effort: if it fails the row stays
//                   'reserved', which is still charged) -> after-publish hooks
//        error   -> look the post up on chain:
//                     present -> settle 'published', report success
//                     absent  -> settle 'failed' (releases the slot)
//                     unknown -> leave 'reserved' (charged; fail closed)

export type ReserveResult = { ok: true; id: number } | { ok: false; reason: "daily_limit" | "unavailable" };

export type SnapFlowDeps = {
  reserve: () => Promise<ReserveResult>;
  broadcast: () => Promise<void>;
  /** true = on chain, false = proven absent, null = could not tell. */
  onChain: () => Promise<boolean | null>;
  settle: (id: number, status: "published" | "failed") => Promise<void>;
  afterPublish: () => Promise<void>;
  log?: (msg: string, e?: unknown) => void;
};

export type SnapFlowResult =
  | { ok: true }
  | { ok: false; status: number; code: "daily_limit" | "unavailable" | "broadcast_failed" | "broadcast_unconfirmed" };

export async function runSnapFlow(d: SnapFlowDeps): Promise<SnapFlowResult> {
  const log = d.log ?? (() => {});
  const r = await d.reserve().catch((): ReserveResult => ({ ok: false, reason: "unavailable" }));
  if (!r.ok) return r.reason === "daily_limit"
    ? { ok: false, status: 429, code: "daily_limit" }
    : { ok: false, status: 503, code: "unavailable" };

  let published = false;
  try {
    await d.broadcast();
    published = true;
  } catch (e) {
    log("broadcast", e);
    const present = await d.onChain().catch(() => null);
    if (present === true) {
      published = true;
    } else if (present === false) {
      await d.settle(r.id, "failed").catch((err) => log("release", err));
      return { ok: false, status: 502, code: "broadcast_failed" };
    } else {
      return { ok: false, status: 502, code: "broadcast_unconfirmed" };
    }
  }

  if (published) {
    await d.settle(r.id, "published").catch((err) => log("settle", err));
    await d.afterPublish().catch((err) => log("after-publish", err));
  }
  return { ok: true };
}
