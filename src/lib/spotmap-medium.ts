// Shared bits of the spotmap `thumbnail_medium` contract (~800px variant for
// the detail hero), used by both /api/spotmap and /api/spotmap/[id].
//
// Contract: thumbnail_medium is ALWAYS present in responses. It is the medium
// image once one exists, otherwise the same full-size image `thumbnail`
// shows, so clients can switch to it now and get smaller images as the
// backfill (scripts/spotmap-image-mirror.ts) fills the column in.

/**
 * True when PostgREST rejected the select because thumbnail_medium doesn't
 * exist yet (the column arrives with a web-owned migration).
 */
export function isMissingMediumColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || /thumbnail_medium.*does not exist/i.test(error.message || "");
}

export function mediumFor(row: {
  thumbnail: string | null;
  thumbnail_override?: string | null;
  thumbnail_medium?: string | null;
}): string | null {
  return row.thumbnail_medium || row.thumbnail_override || row.thumbnail || null;
}
