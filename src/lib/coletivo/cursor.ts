// Opaque, stable keyset cursor: (timestamp, id). Pages are ordered by
// (ts desc, id desc), so rows with equal timestamps never repeat or vanish.
import { LIMITS } from "./config";

export type Cursor = { ts: string; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.ts, c.id])).toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null | "invalid" {
  if (!raw) return null;
  if (raw.length > 200) return "invalid";
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return "invalid";
    const [ts, id] = v;
    if (typeof ts !== "string" || !Number.isFinite(Date.parse(ts)) || typeof id !== "string" || !UUID_RE.test(id)) {
      return "invalid";
    }
    return { ts: new Date(ts).toISOString(), id: id.toLowerCase() };
  } catch {
    return "invalid";
  }
}

export function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(n) || n <= 0) return LIMITS.pageDefault;
  return Math.min(n, LIMITS.pageMax);
}
