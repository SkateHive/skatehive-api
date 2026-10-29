// Spotmap image-size contract for clients that must not decode full-size
// originals (Android/iOS detail hero, widgets). Used by /api/spotmap and
// /api/spotmap/[id].
//
// Fields added to every spot (legacy `thumbnail` / `thumbnail_small` are
// unchanged and still fall back to the full original as before):
//
//   thumbnail_medium        generated medium (<= 800px long side) or null.
//                           Never a small, never the original.
//   thumbnail_bounded       best SIZE-BOUNDED image: the medium, else the
//                           stored small (<= 400px), else null.
//   thumbnail_bounded_kind  "medium" | "small" | null, so a client knows
//                           which bound it got. null = show a placeholder
//                           (or opt in to `thumbnail` knowingly).
//
// Bounds come from how the values are produced: mediums are size-checked by
// scripts/spotmap-image-mirror.ts before they are written; smalls are
// images.hive.blog/400x400 URLs or transcoder outputs requested at 400px.

export const MEDIUM_MAX_PX = 800;
export const SMALL_MAX_PX = 400;

export type BoundedKind = "medium" | "small";

/**
 * True when PostgREST rejected the select because thumbnail_medium doesn't
 * exist yet (the column arrives with a web-owned migration).
 */
export function isMissingMediumColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || /thumbnail_medium.*does not exist/i.test(error.message || "");
}

/** Takes the RAW columns (not the legacy fallback-to-original values). */
export function boundedImageFields(row: {
  thumbnail_small?: string | null;
  thumbnail_medium?: string | null;
}): {
  thumbnail_medium: string | null;
  thumbnail_bounded: string | null;
  thumbnail_bounded_kind: BoundedKind | null;
} {
  const medium = row.thumbnail_medium || null;
  const small = row.thumbnail_small || null;
  return {
    thumbnail_medium: medium,
    thumbnail_bounded: medium || small,
    thumbnail_bounded_kind: medium ? "medium" : small ? "small" : null,
  };
}
