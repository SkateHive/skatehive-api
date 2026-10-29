/**
 * Spotmap image mirroring: plan, inventory and bookkeeping.
 *
 * Google-hosted spot photos are fragile: the lh3.googleusercontent.com/umsh/
 * URLs already return 403 (sampled 2026-10-29), and the
 * mymaps.usercontent.google.com originals are multi-MB PNGs (1-9MB+). This
 * module plans a copy of each original onto IPFS (Pinata) plus a ~800px
 * "medium" variant for the detail hero, without touching the source columns.
 *
 * Everything here is pure or takes an injected fetch, so the CLI
 * (scripts/spotmap-image-mirror.ts) can run a full dry run with no
 * credentials and the logic is unit-tested.
 *
 * Safety model:
 *  - `thumbnail` / `thumbnail_override` are NEVER written. New data goes to
 *    new columns only (thumbnail_medium, image_original_mirror).
 *  - The manifest (JSON on disk) is the mapping source -> CID and the resume
 *    point. It is written after every item.
 *  - DB changes are emitted as a reviewable SQL file, each UPDATE guarded by
 *    the source URL it was planned from, plus a matching rollback file.
 */

import { createHash } from "crypto";

export type SourceClass = "google_mymaps" | "google_lh3" | "hive" | "ipfs" | "other";

export interface SpotImageRow {
  id: string;
  thumbnail: string | null;
  thumbnail_override?: string | null;
  thumbnail_small?: string | null;
}

export type ItemStatus =
  | "planned" // in the inventory, not probed yet
  | "reachable" // probe got an image back
  | "unreachable" // probe got a non-image or error (e.g. lh3 403)
  | "mirrored" // original pinned and medium resolved
  | "degraded" // original lost at the source; nothing to pin or write (the API serves the existing small)
  | "failed"; // last execute attempt failed (see lastError)

export interface ManifestItem {
  sourceUrl: string;
  sourceClass: SourceClass;
  spotIds: string[];
  /** Existing small (400px) thumbnail for this source, if any. */
  smallUrl: string | null;
  status: ItemStatus;
  httpStatus?: number;
  contentType?: string;
  bytes?: number;
  truncated?: boolean;
  width?: number;
  height?: number;
  sha256?: string;
  originalCid?: string;
  mediumUrl?: string;
  /** Set only after the medium was fetched and its size checked. */
  mediumCheck?: { format: string; width: number; height: number; bytes: number };
  attempts: number;
  lastError?: string;
  updatedAt: string;
}

export interface Manifest {
  version: 1;
  createdAt: string;
  updatedAt: string;
  items: Record<string, ManifestItem>;
}

const MIRROR_CLASSES: SourceClass[] = ["google_mymaps", "google_lh3"];

export function classifySource(url: string): SourceClass {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "mymaps.usercontent.google.com") return "google_mymaps";
  if (host === "lh3.googleusercontent.com" || host.endsWith(".googleusercontent.com")) return "google_lh3";
  if (host === "images.hive.blog" || host === "files.peakd.com") return "hive";
  if (host === "ipfs.skatehive.app" || host.endsWith(".mypinata.cloud") || host === "gateway.pinata.cloud") return "ipfs";
  return "other";
}

/** The image a spot actually shows: admin override first, then the synced one. */
export function effectiveSource(row: SpotImageRow): string | null {
  const src = (row.thumbnail_override || row.thumbnail || "").trim();
  return /^https:\/\//i.test(src) ? src : null;
}

/** Only Google-hosted sources are mirrored; Hive and IPFS are already durable. */
export function needsMirror(sourceClass: SourceClass): boolean {
  return MIRROR_CLASSES.includes(sourceClass);
}

export function emptyManifest(now: string): Manifest {
  return { version: 1, createdAt: now, updatedAt: now, items: {} };
}

/**
 * Merge the current spot rows into a manifest. Idempotent: running it again
 * with the same rows changes nothing; finished items keep their results. A
 * source shared by several spots becomes one item (one download, one pin).
 */
export function mergeInventory(manifest: Manifest, rows: SpotImageRow[], now: string): Manifest {
  const items: Record<string, ManifestItem> = {};
  for (const [k, v] of Object.entries(manifest.items)) items[k] = { ...v, spotIds: [] };

  for (const row of rows) {
    const src = effectiveSource(row);
    if (!src) continue;
    const sourceClass = classifySource(src);
    if (!needsMirror(sourceClass)) continue;
    const existing = items[src];
    const small = row.thumbnail_small && row.thumbnail_small !== src ? row.thumbnail_small : null;
    if (existing) {
      if (!existing.spotIds.includes(row.id)) existing.spotIds.push(row.id);
      existing.smallUrl = existing.smallUrl || small;
    } else {
      items[src] = {
        sourceUrl: src,
        sourceClass,
        spotIds: [row.id],
        smallUrl: small,
        status: "planned",
        attempts: 0,
        updatedAt: now,
      };
    }
  }

  // Sources no spot points at any more are dropped from the plan, unless
  // they were already pinned (kept so the rollback/unpin list stays complete).
  for (const [k, v] of Object.entries(items)) {
    if (v.spotIds.length === 0 && !v.originalCid) delete items[k];
    else v.spotIds.sort();
  }
  return { ...manifest, updatedAt: now, items };
}

export interface InventorySummary {
  spots: number;
  spotsWithImage: number;
  spotsImageless: number;
  byClass: Record<string, number>;
  mirrorItems: number;
  mirrorSpots: number;
  sharedSources: number;
  withSmall: number;
  byStatus: Record<string, number>;
}

export function summarize(rows: SpotImageRow[], manifest: Manifest): InventorySummary {
  const byClass: Record<string, number> = {};
  let withImage = 0;
  for (const row of rows) {
    const src = effectiveSource(row);
    if (!src) continue;
    withImage++;
    const c = classifySource(src);
    byClass[c] = (byClass[c] || 0) + 1;
  }
  const items = Object.values(manifest.items).filter((i) => i.spotIds.length > 0);
  const byStatus: Record<string, number> = {};
  for (const i of items) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  return {
    spots: rows.length,
    spotsWithImage: withImage,
    spotsImageless: rows.length - withImage,
    byClass,
    mirrorItems: items.length,
    mirrorSpots: items.reduce((n, i) => n + i.spotIds.length, 0),
    sharedSources: items.filter((i) => i.spotIds.length > 1).length,
    withSmall: items.filter((i) => i.smallUrl).length,
    byStatus,
  };
}

/** Items the next probe/execute run should work on, in a stable order. */
export function selectWork(
  manifest: Manifest,
  opts: { statuses: ItemStatus[]; limit: number; maxAttempts?: number }
): ManifestItem[] {
  const maxAttempts = opts.maxAttempts ?? 3;
  return Object.values(manifest.items)
    .filter((i) => i.spotIds.length > 0 && opts.statuses.includes(i.status) && i.attempts < maxAttempts)
    .sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))
    .slice(0, opts.limit);
}

// ---------------------------------------------------------------- downloads

export interface BoundedFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
  error?: string;
}

/**
 * GET with a hard byte cap and timeout. Streams the body and stops reading at
 * maxBytes (Google ignores Range, so a Range header alone isn't a bound).
 */
export async function boundedFetch(
  url: string,
  opts: { maxBytes: number; timeoutMs: number; fetchImpl?: typeof fetch }
): Promise<BoundedFetchResult> {
  const doFetch = opts.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await doFetch(url, { signal: controller.signal, redirect: "follow" });
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        if (total + chunk.length > opts.maxBytes) {
          chunks.push(chunk.subarray(0, opts.maxBytes - total));
          total = opts.maxBytes;
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(chunk);
        total += chunk.length;
      }
    }
    return { ok: res.ok, status: res.status, contentType, body: Buffer.concat(chunks), truncated };
  } catch (err: any) {
    return { ok: false, status: 0, contentType: "", body: Buffer.alloc(0), truncated: false, error: err?.name === "AbortError" ? "timeout" : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads width/height from PNG, JPEG, GIF or WebP headers. */
export function imageDimensions(b: Buffer): { format: string; width?: number; height?: number } {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && b.toString("latin1", 0, 3) === "GIF") {
    return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { format: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { format: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const v = b.readUInt32LE(21);
      return { format: "webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp" };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) {
        return { format: "jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { format: "jpeg" };
  }
  return { format: "unknown" };
}

export function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

/** Applies a probe/download result to one manifest item (pure). */
export function applyProbe(item: ManifestItem, r: BoundedFetchResult, now: string): ManifestItem {
  const dims = r.body.length ? imageDimensions(r.body) : { format: "unknown" };
  const isImage = r.ok && (r.contentType.startsWith("image/") || dims.format !== "unknown");
  return {
    ...item,
    status: isImage ? "reachable" : "unreachable",
    httpStatus: r.status,
    contentType: r.contentType || undefined,
    // A truncated read is only a lower bound on size.
    bytes: isImage ? r.body.length : undefined,
    truncated: isImage ? r.truncated : undefined,
    width: dims.width,
    height: dims.height,
    sha256: isImage && !r.truncated ? sha256(r.body) : item.sha256,
    lastError: isImage ? undefined : r.error || `HTTP ${r.status} ${r.contentType || ""}`.trim(),
    updatedAt: now,
  };
}

/**
 * The medium must be a real image whose long side is <= maxPx; the client
 * contract (thumbnail_bounded_kind = "medium") depends on it. Returns the
 * measured check, or an error string.
 */
export function verifyMedium(
  r: BoundedFetchResult,
  maxPx: number
): { ok: true; check: NonNullable<ManifestItem["mediumCheck"]> } | { ok: false; error: string } {
  if (!r.ok) return { ok: false, error: `medium fetch ${r.status || r.error || "failed"}` };
  if (r.truncated) return { ok: false, error: "medium larger than the byte cap" };
  const dims = imageDimensions(r.body);
  if (!dims.width || !dims.height) return { ok: false, error: `medium is not a readable image (${dims.format})` };
  if (Math.max(dims.width, dims.height) > maxPx) {
    return { ok: false, error: `medium is ${dims.width}x${dims.height}, over ${maxPx}px` };
  }
  return { ok: true, check: { format: dims.format, width: dims.width, height: dims.height, bytes: r.body.length } };
}

// ---------------------------------------------------------------- estimates

export interface VolumeEstimate {
  mirrorItems: number;
  reachableItems: number;
  unreachableItems: number;
  unprobedItems: number;
  sampledReachable: number;
  /** Mean original size of reachable probed items (lower bound if any were truncated). */
  meanOriginalBytes: number | null;
  truncatedSamples: number;
  estOriginalBytes: number | null;
  estMediumBytes: number;
  pinCount: number;
}

/**
 * Pin volume: one original per reachable item plus one medium per item.
 * Estimated PER HOST CLASS: unprobed items take their own class's reachable
 * ratio and mean size (dead lh3 links must not drag down the My Maps
 * estimate). Medium size uses `mediumBytesEach` (default 150KB: ~800px JPEG;
 * the existing 400px smalls on ipfs.skatehive.app sampled at 17-43KB).
 * Degraded items reuse their existing small, so they add no pin.
 */
export function estimateVolume(manifest: Manifest, mediumBytesEach = 150_000): VolumeEstimate {
  const items = Object.values(manifest.items).filter((i) => i.spotIds.length > 0);
  const isReachable = (i: ManifestItem) => ["reachable", "mirrored"].includes(i.status);
  const isUnreachable = (i: ManifestItem) => ["unreachable", "degraded"].includes(i.status);

  let estReachable = 0;
  let estOriginal = 0;
  let canEstimateOriginal = true;
  const classes = Array.from(new Set(items.map((i) => i.sourceClass)));
  for (const cls of classes) {
    const group = items.filter((i) => i.sourceClass === cls);
    const probed = group.filter((i) => i.status !== "planned");
    const reachable = group.filter(isReachable);
    const sized = reachable.filter((i) => typeof i.bytes === "number");
    const unprobed = group.length - probed.length;
    const ratio = probed.length ? reachable.length / probed.length : 1;
    const groupReachable = reachable.length + unprobed * ratio;
    estReachable += groupReachable;
    if (groupReachable > 0) {
      if (!sized.length) canEstimateOriginal = false;
      else estOriginal += (sized.reduce((n, i) => n + (i.bytes || 0), 0) / sized.length) * groupReachable;
    }
  }

  const reachable = items.filter(isReachable);
  const sized = reachable.filter((i) => typeof i.bytes === "number");
  const mean = sized.length ? sized.reduce((n, i) => n + (i.bytes || 0), 0) / sized.length : null;
  return {
    mirrorItems: items.length,
    reachableItems: reachable.length,
    unreachableItems: items.filter(isUnreachable).length,
    unprobedItems: items.filter((i) => i.status === "planned").length,
    sampledReachable: sized.length,
    meanOriginalBytes: mean === null ? null : Math.round(mean),
    truncatedSamples: sized.filter((i) => i.truncated).length,
    estOriginalBytes: canEstimateOriginal ? Math.round(estOriginal) : null,
    estMediumBytes: Math.round(estReachable * mediumBytesEach),
    pinCount: Math.round(estReachable * 2),
  };
}

// ---------------------------------------------------------------- SQL review

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Reviewable UPDATEs for finished items. Each one is guarded by the source it
 * was planned from, so a spot whose image changed since the plan is left
 * alone. Only the two new columns are written, and only for items whose
 * medium passed verifyMedium (degraded items write nothing).
 */
export function buildApplySql(manifest: Manifest, gatewayBase: string): string {
  const lines = [
    "-- Generated by scripts/spotmap-image-mirror.ts. Review before running.",
    "-- Writes ONLY thumbnail_medium and image_original_mirror; source columns untouched.",
    "begin;",
  ];
  for (const item of Object.values(manifest.items).sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))) {
    if (item.status !== "mirrored" || !item.mediumUrl || !item.mediumCheck || item.spotIds.length === 0) continue;
    const original = item.originalCid ? sqlString(`${gatewayBase.replace(/\/$/, "")}/ipfs/${item.originalCid}`) : "null";
    lines.push(
      `update public.spotmap_spots set thumbnail_medium = ${sqlString(item.mediumUrl)}, image_original_mirror = ${original}` +
        ` where id in (${item.spotIds.map(sqlString).join(", ")})` +
        ` and coalesce(nullif(thumbnail_override, ''), thumbnail) = ${sqlString(item.sourceUrl)};`
    );
  }
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

/** Undo for buildApplySql: clears only what it set, only where it set it. */
export function buildRollbackSql(manifest: Manifest): string {
  const lines = ["-- Rollback for the matching apply file.", "begin;"];
  for (const item of Object.values(manifest.items).sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))) {
    if (!item.mediumUrl || item.spotIds.length === 0) continue;
    lines.push(
      `update public.spotmap_spots set thumbnail_medium = null, image_original_mirror = null` +
        ` where id in (${item.spotIds.map(sqlString).join(", ")}) and thumbnail_medium = ${sqlString(item.mediumUrl)};`
    );
  }
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

/** Stable hash of the work an execute run would do; the CLI requires it back. */
export function planHash(manifest: Manifest): string {
  const work = Object.values(manifest.items)
    .filter((i) => i.spotIds.length > 0)
    .map((i) => `${i.sourceUrl}|${i.status}|${i.spotIds.join(",")}`)
    .sort()
    .join("\n");
  return sha256(Buffer.from(work)).slice(0, 12);
}
