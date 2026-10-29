import { describe, expect, it } from "vitest";
import {
  applyProbe,
  boundedFetch,
  buildApplySql,
  buildRollbackSql,
  classifySource,
  emptyManifest,
  estimateVolume,
  imageDimensions,
  mergeInventory,
  planHash,
  selectWork,
  summarize,
  verifyMedium,
  type SpotImageRow,
} from "./spotmap-mirror";

const T = "2026-10-29T00:00:00.000Z";
const MYMAPS = "https://mymaps.usercontent.google.com/hostedimage/m/*/abc?authuser=0";
const LH3 = "https://lh3.googleusercontent.com/umsh/AN6v0v5P8nJL";
const HIVE = "https://images.hive.blog/DQmX/p.jpg";

const rows: SpotImageRow[] = [
  { id: "s1", thumbnail: MYMAPS, thumbnail_small: "https://ipfs.skatehive.app/ipfs/bafkSmall1" },
  { id: "s2", thumbnail: MYMAPS, thumbnail_small: null }, // same source as s1
  { id: "s3", thumbnail: LH3, thumbnail_small: "https://ipfs.skatehive.app/ipfs/bafkSmall3" },
  { id: "s4", thumbnail: HIVE },
  { id: "s5", thumbnail: null },
  { id: "s6", thumbnail: HIVE, thumbnail_override: MYMAPS }, // override wins
];

function png(width: number, height: number, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function streamResponse(body: Buffer, init: { status?: number; type?: string } = {}) {
  return new Response(new Blob([new Uint8Array(body)]).stream(), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "image/png" },
  });
}

describe("classifySource", () => {
  it("separates Google, Hive and IPFS hosts", () => {
    expect(classifySource(MYMAPS)).toBe("google_mymaps");
    expect(classifySource(LH3)).toBe("google_lh3");
    expect(classifySource(HIVE)).toBe("hive");
    expect(classifySource("https://ipfs.skatehive.app/ipfs/x")).toBe("ipfs");
    expect(classifySource("not a url")).toBe("other");
  });
});

describe("mergeInventory", () => {
  it("dedupes shared sources, honours overrides and skips Hive / imageless spots", () => {
    const m = mergeInventory(emptyManifest(T), rows, T);
    expect(Object.keys(m.items).sort()).toEqual([LH3, MYMAPS].sort());
    expect(m.items[MYMAPS].spotIds).toEqual(["s1", "s2", "s6"]);
    expect(m.items[MYMAPS].smallUrl).toBe("https://ipfs.skatehive.app/ipfs/bafkSmall1");
    const s = summarize(rows, m);
    expect(s).toMatchObject({ spots: 6, spotsImageless: 1, mirrorItems: 2, mirrorSpots: 4, sharedSources: 1, withSmall: 2 });
  });

  it("is idempotent and keeps finished results across runs", () => {
    const first = mergeInventory(emptyManifest(T), rows, T);
    first.items[MYMAPS] = { ...first.items[MYMAPS], status: "mirrored", originalCid: "bafyOrig", mediumUrl: "https://ipfs.skatehive.app/ipfs/bafyMed" };
    const again = mergeInventory(first, rows, "2026-10-30T00:00:00.000Z");
    expect(again.items[MYMAPS]).toMatchObject({ status: "mirrored", originalCid: "bafyOrig", spotIds: ["s1", "s2", "s6"] });
    expect(planHash(again)).toBe(planHash(first));
  });

  it("drops sources no spot uses any more, but keeps pinned ones for rollback", () => {
    const m = mergeInventory(emptyManifest(T), rows, T);
    m.items[LH3] = { ...m.items[LH3], originalCid: "bafyKeep" };
    const next = mergeInventory(m, [{ id: "s4", thumbnail: HIVE }], T);
    expect(next.items[MYMAPS]).toBeUndefined();
    expect(next.items[LH3]).toMatchObject({ originalCid: "bafyKeep", spotIds: [] });
    expect(selectWork(next, { statuses: ["planned"], limit: 10 })).toHaveLength(0);
  });
});

describe("boundedFetch", () => {
  it("stops reading at maxBytes even when the server ignores Range", async () => {
    const big = png(4032, 3024, 5000);
    const r = await boundedFetch("https://x", { maxBytes: 1000, timeoutMs: 5000, fetchImpl: (async () => streamResponse(big)) as any });
    expect(r).toMatchObject({ ok: true, truncated: true, contentType: "image/png" });
    expect(r.body.length).toBe(1000);
    expect(imageDimensions(r.body)).toEqual({ format: "png", width: 4032, height: 3024 });
  });

  it("reports a timeout instead of hanging", async () => {
    const hang = ((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as any;
    const r = await boundedFetch("https://x", { maxBytes: 10, timeoutMs: 20, fetchImpl: hang });
    expect(r).toMatchObject({ ok: false, status: 0, error: "timeout" });
  });
});

describe("applyProbe", () => {
  const base = mergeInventory(emptyManifest(T), rows, T);

  it("marks an image reachable with size, dimensions and hash", async () => {
    const r = await boundedFetch("https://x", { maxBytes: 1e6, timeoutMs: 5000, fetchImpl: (async () => streamResponse(png(2048, 1536, 100))) as any });
    const item = applyProbe(base.items[MYMAPS], r, T);
    expect(item).toMatchObject({ status: "reachable", httpStatus: 200, width: 2048, height: 1536, truncated: false });
    expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks a Google 403 HTML page unreachable", async () => {
    const r = await boundedFetch("https://x", { maxBytes: 1e6, timeoutMs: 5000, fetchImpl: (async () => streamResponse(Buffer.from("<!DOCTYPE html>403"), { status: 403, type: "text/html; charset=UTF-8" })) as any });
    const item = applyProbe(base.items[LH3], r, T);
    expect(item).toMatchObject({ status: "unreachable", httpStatus: 403, lastError: "HTTP 403 text/html" });
    expect(item.bytes).toBeUndefined();
  });
});

describe("verifyMedium", () => {
  const ok = (body: Buffer) => ({ ok: true, status: 200, contentType: "image/png", body, truncated: false });

  it("accepts an image whose long side is within the bound", () => {
    expect(verifyMedium(ok(png(800, 600)), 800)).toMatchObject({ ok: true, check: { width: 800, height: 600, format: "png" } });
  });

  it("rejects an oversized image, e.g. a transcoder that clamped nothing", () => {
    expect(verifyMedium(ok(png(2048, 1536)), 800)).toEqual({ ok: false, error: "medium is 2048x1536, over 800px" });
  });

  it("rejects truncated, failed and non-image responses", () => {
    expect(verifyMedium({ ...ok(png(10, 10)), truncated: true }, 800).ok).toBe(false);
    expect(verifyMedium({ ...ok(Buffer.alloc(0)), ok: false, status: 404 }, 800)).toEqual({ ok: false, error: "medium fetch 404" });
    expect(verifyMedium(ok(Buffer.from("<html>")), 800).ok).toBe(false);
  });
});

describe("estimateVolume", () => {
  it("extrapolates unprobed items from the probed sample", () => {
    const m = mergeInventory(emptyManifest(T), [
      ...rows,
      { id: "s7", thumbnail: "https://mymaps.usercontent.google.com/hostedimage/m/*/def" },
    ], T);
    m.items[MYMAPS] = { ...m.items[MYMAPS], status: "reachable", bytes: 4_000_000 };
    m.items[LH3] = { ...m.items[LH3], status: "unreachable" };
    const e = estimateVolume(m, 100_000);
    // Per class: My Maps is 1/1 reachable, so its unprobed item counts as
    // reachable; the dead lh3 item does not lower that.
    expect(e).toMatchObject({ mirrorItems: 3, reachableItems: 1, unreachableItems: 1, unprobedItems: 1, meanOriginalBytes: 4_000_000 });
    expect(e.estOriginalBytes).toBe(8_000_000);
    expect(e.estMediumBytes).toBe(200_000);
    expect(e.pinCount).toBe(4);
  });
});

describe("SQL review files", () => {
  const CHECK = { format: "jpeg", width: 800, height: 600, bytes: 90_000 };

  it("writes only the new columns, guarded by the planned source, with a matching rollback", () => {
    const m = mergeInventory(emptyManifest(T), rows, T);
    m.items[MYMAPS] = { ...m.items[MYMAPS], status: "mirrored", originalCid: "bafyOrig", mediumUrl: "https://ipfs.skatehive.app/ipfs/bafyMed", mediumCheck: CHECK };
    m.items[LH3] = { ...m.items[LH3], status: "degraded" };
    const apply = buildApplySql(m, "https://ipfs.skatehive.app/");
    expect(apply).toContain("set thumbnail_medium = 'https://ipfs.skatehive.app/ipfs/bafyMed', image_original_mirror = 'https://ipfs.skatehive.app/ipfs/bafyOrig'");
    expect(apply).toContain("where id in ('s1', 's2', 's6') and coalesce(nullif(thumbnail_override, ''), thumbnail) = 'https://mymaps.usercontent.google.com/hostedimage/m/*/abc?authuser=0'");
    // A dead source writes nothing: a small must never land in thumbnail_medium.
    expect(apply).not.toContain("'s3'");
    expect(apply).not.toMatch(/set thumbnail\s*=|thumbnail_override\s*=\s*'/);
    const rollback = buildRollbackSql(m);
    expect(rollback).toContain("set thumbnail_medium = null, image_original_mirror = null where id in ('s1', 's2', 's6') and thumbnail_medium = 'https://ipfs.skatehive.app/ipfs/bafyMed'");
  });

  it("skips a mirrored item whose medium was never size-checked", () => {
    const m = mergeInventory(emptyManifest(T), rows, T);
    m.items[MYMAPS] = { ...m.items[MYMAPS], status: "mirrored", mediumUrl: "https://ipfs.skatehive.app/ipfs/bafyMed" };
    expect(buildApplySql(m, "https://g")).not.toContain("bafyMed");
  });

  it("escapes quotes", () => {
    const m = mergeInventory(emptyManifest(T), [{ id: "o'neil", thumbnail: MYMAPS }], T);
    m.items[MYMAPS] = { ...m.items[MYMAPS], status: "mirrored", mediumUrl: "https://x/it's", mediumCheck: CHECK };
    expect(buildApplySql(m, "https://g")).toContain("'o''neil'");
    expect(buildApplySql(m, "https://g")).toContain("'https://x/it''s'");
  });
});
