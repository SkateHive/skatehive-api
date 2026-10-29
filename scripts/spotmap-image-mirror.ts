/**
 * Spotmap image mirror: dry-run inventory -> bounded probe -> estimate ->
 * (reviewed) execute -> SQL for review. See src/lib/spotmap-mirror.ts.
 *
 * Steps (each one resumable; state lives in the manifest file):
 *
 *   inventory  Read spots and build/merge the manifest. Default source is the
 *              PUBLIC https://api.skatehive.app/api/spotmap (no credentials,
 *              read-only). --source db reads spotmap_spots directly and needs
 *              SUPABASE_USERBASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   probe      Download originals with a byte cap + timeout (--class to pick
 *              one host class), record status,
 *              type, size, dimensions, sha256. Optional --cache-dir keeps the
 *              bytes (named by sha256) so execute doesn't download again.
 *   estimate   Print storage / pin volume from the probed sample.
 *   execute    EXTERNAL WRITES. Requires --plan <hash> printed by `inventory`
 *              or `estimate` (so it runs exactly the reviewed plan) and:
 *                PINATA_JWT                      pin originals
 *                IMAGE_THUMBNAIL_SERVICE_URL     medium via the transcoder
 *                THUMBNAIL_SHARED_SECRET
 *              Never writes the database.
 *   sql        Write apply + rollback SQL for review (no DB connection).
 *
 * Usage:
 *   pnpm mirror:spot-images inventory
 *   pnpm mirror:spot-images probe --limit 40 --concurrency 2
 *   pnpm mirror:spot-images estimate
 *   pnpm mirror:spot-images execute --plan <hash> --limit 10
 *   pnpm mirror:spot-images sql --gateway https://ipfs.skatehive.app
 *
 * Common flags: --manifest <path> (default .spotmap-mirror/manifest.json)
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyProbe,
  boundedFetch,
  buildApplySql,
  buildRollbackSql,
  emptyManifest,
  estimateVolume,
  mergeInventory,
  planHash,
  selectWork,
  sha256,
  summarize,
  verifyMedium,
  type Manifest,
  type ManifestItem,
  type SpotImageRow,
} from "../src/lib/spotmap-mirror";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });

const argv = process.argv.slice(2);
const command = argv[0];
function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}
const num = (name: string, fallback: number) => Number(flag(name)) || fallback;

const MANIFEST = path.resolve(flag("manifest", path.join(repoRoot, ".spotmap-mirror/manifest.json"))!);
const MAX_BYTES = num("max-bytes", 25 * 1024 * 1024);
const TIMEOUT_MS = num("timeout-ms", 30_000);
const MEDIUM_PX = num("medium-px", 800);
const PUBLIC_SPOTMAP = flag("public-url", "https://api.skatehive.app/api/spotmap")!;

const now = () => new Date().toISOString();
const log = (msg: string) => console.log(`[${now()}] ${msg}`);
const mb = (n: number | null | undefined) => (n == null ? "?" : `${(n / 1024 / 1024).toFixed(1)}MB`);

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST)) return emptyManifest(now());
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

// Write to a temp file and rename, so an interrupted run never leaves a
// half-written manifest.
function saveManifest(m: Manifest) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  const tmp = `${MANIFEST}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
  fs.renameSync(tmp, MANIFEST);
}

async function readSpots(): Promise<SpotImageRow[]> {
  const source = flag("source", "public");
  if (source === "db") {
    const { supabaseAdmin } = await import("../src/app/utils/supabase/supabaseClient");
    if (!supabaseAdmin) throw new Error("--source db needs SUPABASE_USERBASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    const { data, error } = await supabaseAdmin
      .from("spotmap_spots")
      .select("id, thumbnail, thumbnail_override, thumbnail_small")
      .limit(10000);
    if (error) throw new Error(`spotmap_spots query failed: ${error.message}`);
    return (data || []) as SpotImageRow[];
  }
  // Public read. `thumbnail` here is already override-coalesced by the API.
  const res = await fetch(PUBLIC_SPOTMAP);
  if (!res.ok) throw new Error(`GET ${PUBLIC_SPOTMAP} -> ${res.status}`);
  const json: any = await res.json();
  return (json.spots || []).map((s: any) => ({
    id: s.id,
    thumbnail: s.thumbnail,
    thumbnail_small: s.thumbnail_small,
  }));
}

/** Runs fn over items with a small concurrency cap, saving after each. */
async function forEachBounded(
  m: Manifest,
  items: ManifestItem[],
  concurrency: number,
  fn: (item: ManifestItem) => Promise<ManifestItem>
) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      const updated = await fn(item);
      m.items[item.sourceUrl] = updated;
      m.updatedAt = now();
      saveManifest(m);
      done++;
      log(`[${done}/${items.length}] ${updated.status} ${updated.httpStatus ?? ""} ${mb(updated.bytes)} ${updated.width ?? "?"}x${updated.height ?? "?"} ${item.sourceUrl.slice(0, 80)}`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

function printEstimate(m: Manifest) {
  const e = estimateVolume(m);
  log(`mirror items=${e.mirrorItems} reachable=${e.reachableItems} unreachable=${e.unreachableItems} unprobed=${e.unprobedItems}`);
  log(`mean original=${mb(e.meanOriginalBytes)} over ${e.sampledReachable} sample(s)${e.truncatedSamples ? ` (${e.truncatedSamples} truncated at --max-bytes: lower bound)` : ""}`);
  log(`est. originals=${mb(e.estOriginalBytes)} + mediums=${mb(e.estMediumBytes)} in ~${e.pinCount} pins`);
  log(`plan hash: ${planHash(m)}`);
}

async function pinOriginal(bytes: Buffer, item: ManifestItem, jwt: string): Promise<string> {
  const form = new FormData();
  const ext = (item.contentType || "image/png").split("/")[1] || "bin";
  form.append("file", new Blob([new Uint8Array(bytes)], { type: item.contentType || "application/octet-stream" }), `spot-original-${sha256(bytes).slice(0, 16)}.${ext}`);
  form.append("pinataMetadata", JSON.stringify({
    name: `spotmap-original-${sha256(bytes).slice(0, 16)}`,
    keyvalues: { app: "skatehive", kind: "spotmap-original", sha256: sha256(bytes) },
  }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`pinata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  if (!json.IpfsHash) throw new Error("pinata response missing IpfsHash");
  return json.IpfsHash;
}

async function requestMedium(sourceUrl: string, serviceUrl: string, secret: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(serviceUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-thumbnail-secret": secret },
      body: JSON.stringify({ url: sourceUrl, maxPx: MEDIUM_PX }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`image-thumbnail ${res.status}`);
    const json: any = await res.json().catch(() => null);
    if (!json?.url) throw new Error("image-thumbnail response missing url");
    return json.url;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const m = loadManifest();

  if (command === "inventory") {
    const rows = await readSpots();
    const merged = mergeInventory(m, rows, now());
    saveManifest(merged);
    const s = summarize(rows, merged);
    log(`spots=${s.spots} with image=${s.spotsWithImage} imageless=${s.spotsImageless}`);
    log(`by host class: ${JSON.stringify(s.byClass)}`);
    log(`to mirror: ${s.mirrorItems} unique source(s) for ${s.mirrorSpots} spot(s); ${s.sharedSources} shared; ${s.withSmall} already have a small`);
    log(`status: ${JSON.stringify(s.byStatus)}`);
    log(`manifest: ${MANIFEST}`);
    log(`plan hash: ${planHash(merged)}`);
    return;
  }

  if (command === "probe") {
    const cacheDir = flag("cache-dir");
    // --class google_lh3|google_mymaps samples one host class at a time.
    const cls = flag("class");
    const work = selectWork(m, { statuses: ["planned"], limit: Infinity })
      .filter((i) => !cls || i.sourceClass === cls)
      .slice(0, num("limit", 20));
    log(`probing ${work.length} item(s), max ${mb(MAX_BYTES)} each, timeout ${TIMEOUT_MS}ms`);
    await forEachBounded(m, work, num("concurrency", 2), async (item) => {
      const r = await boundedFetch(item.sourceUrl, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
      const updated = applyProbe(item, r, now());
      if (cacheDir && updated.status === "reachable" && !updated.truncated && updated.sha256) {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, updated.sha256), r.body);
      }
      return updated;
    });
    printEstimate(m);
    return;
  }

  if (command === "estimate") {
    printEstimate(m);
    return;
  }

  if (command === "execute") {
    const expected = planHash(m);
    if (flag("plan") !== expected) {
      console.error(`Refusing to execute: pass --plan ${expected} (the hash of the plan you reviewed). It changes whenever the manifest's work changes.`);
      process.exit(2);
    }
    const jwt = process.env.PINATA_JWT;
    const serviceUrl = process.env.IMAGE_THUMBNAIL_SERVICE_URL;
    const secret = process.env.THUMBNAIL_SHARED_SECRET;
    const missing = [!jwt && "PINATA_JWT", !serviceUrl && "IMAGE_THUMBNAIL_SERVICE_URL", !secret && "THUMBNAIL_SHARED_SECRET"].filter(Boolean);
    if (missing.length) {
      console.error(`Missing env: ${missing.join(", ")}`);
      process.exit(1);
    }
    const cacheDir = flag("cache-dir");
    // Already-pinned bytes, so a duplicate image is never pinned twice.
    const cidBySha = new Map<string, string>();
    for (const i of Object.values(m.items)) if (i.sha256 && i.originalCid) cidBySha.set(i.sha256, i.originalCid);

    const work = selectWork(m, { statuses: ["reachable", "unreachable", "failed"], limit: num("limit", 10) });
    log(`executing ${work.length} item(s)`);
    await forEachBounded(m, work, 1, async (item) => {
      const attempt = { ...item, attempts: item.attempts + 1, updatedAt: now() };
      try {
        if (item.status === "unreachable") {
          // Original is gone at the source: nothing to pin, nothing to write.
          // The API already serves the existing small as thumbnail_bounded.
          if (!item.smallUrl) return { ...attempt, status: "failed", lastError: "source unreachable and no small thumbnail" };
          return { ...attempt, status: "degraded", lastError: undefined };
        }
        let bytes: Buffer | null = null;
        const cached = cacheDir && item.sha256 ? path.join(cacheDir, item.sha256) : null;
        if (cached && fs.existsSync(cached)) bytes = fs.readFileSync(cached);
        if (!bytes) {
          const r = await boundedFetch(item.sourceUrl, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
          if (!r.ok || r.truncated) throw new Error(r.truncated ? `original larger than ${mb(MAX_BYTES)}` : `download ${r.status}`);
          bytes = r.body;
        }
        const digest = sha256(bytes);
        const originalCid = item.originalCid || cidBySha.get(digest) || (await pinOriginal(bytes, item, jwt!));
        cidBySha.set(digest, originalCid);
        const mediumUrl = item.mediumUrl || (await requestMedium(item.sourceUrl, serviceUrl!, secret!));
        // Don't trust maxPx: fetch the medium and measure it.
        const check = verifyMedium(await boundedFetch(mediumUrl, { maxBytes: 3 * 1024 * 1024, timeoutMs: TIMEOUT_MS }), MEDIUM_PX);
        if (!check.ok) {
          // Drop the rejected medium so a retry requests a new one.
          return { ...attempt, status: "failed", sha256: digest, bytes: bytes.length, originalCid, mediumUrl: undefined, mediumCheck: undefined, lastError: `${check.error} (${mediumUrl})` };
        }
        return { ...attempt, status: "mirrored", sha256: digest, bytes: bytes.length, originalCid, mediumUrl, mediumCheck: check.check, lastError: undefined };
      } catch (err: any) {
        return { ...attempt, status: "failed", lastError: String(err?.message || err) };
      }
    });
    printEstimate(m);
    return;
  }

  if (command === "sql") {
    const gateway = flag("gateway", "https://ipfs.skatehive.app")!;
    const dir = path.dirname(MANIFEST);
    fs.writeFileSync(path.join(dir, "apply.sql"), buildApplySql(m, gateway));
    fs.writeFileSync(path.join(dir, "rollback.sql"), buildRollbackSql(m));
    log(`wrote ${path.join(dir, "apply.sql")} and rollback.sql (not executed)`);
    return;
  }

  console.error("usage: spotmap-image-mirror <inventory|probe|estimate|execute|sql> [flags]  (see header)");
  process.exit(1);
}

main().catch((err) => {
  console.error("spotmap-image-mirror failed:", err);
  process.exit(1);
});
