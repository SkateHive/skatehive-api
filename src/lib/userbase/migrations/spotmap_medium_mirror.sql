-- Spotmap images: ~800px medium variant for the detail hero, and a preserved
-- IPFS copy of the original source image.
--
-- NOT applied by this agent. spotmap_spots is web-owned schema. The CANONICAL
-- migration is skatehive3.0/sql/migrations/0035_spotmap_medium_mirror.sql
-- (draft web PR https://github.com/SkateHive/skatehive3.0/pull/270), applied
-- to the userbase project. This file is the API-side record only and must
-- match it exactly; do not apply it separately.
--
-- Both columns are nullable text with no default, backfill or index. They
-- are written only via the reviewed apply.sql from
-- scripts/spotmap-image-mirror.ts. The Hive/KML syncs and the mobile upsert
-- never write them, and `thumbnail` / `thumbnail_override` /
-- `thumbnail_small` are never modified.
--
-- Rollback (see docs/SPOTMAP_IMAGE_MIRROR.md): dropping the columns deletes
-- their data but NOT the IPFS pins; keep the mirror manifest. It takes an
-- ACCESS EXCLUSIVE lock, so it is not lock-free on production. The API falls
-- back cleanly when thumbnail_medium is missing.

alter table public.spotmap_spots
  add column if not exists thumbnail_medium text,
  add column if not exists image_original_mirror text;
