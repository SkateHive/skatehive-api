-- Spotmap images: ~800px medium variant for the detail hero, and a preserved
-- IPFS copy of the original source image.
--
-- NOT applied by this agent. Like spotmap_thumbnails.sql, spotmap_spots is
-- web-owned schema: the CANONICAL copy of this change belongs in
-- skatehive3.0/sql/migrations (next number after 0033), applied to the
-- userbase project. This file is the API-side record only; do not apply it
-- separately.
--
-- Both columns are written only by scripts/spotmap-image-mirror.ts, via a
-- reviewed SQL file. The Hive/KML syncs and the mobile upsert never write
-- them, so they survive re-syncs. `thumbnail` / `thumbnail_override` are
-- never modified.
--
-- Rollback: `alter table public.spotmap_spots drop column if exists
-- thumbnail_medium, drop column if exists image_original_mirror;` (the API
-- falls back cleanly when thumbnail_medium is missing; see
-- src/lib/spotmap-medium.ts).

alter table public.spotmap_spots
  add column if not exists thumbnail_medium text,
  add column if not exists image_original_mirror text;
