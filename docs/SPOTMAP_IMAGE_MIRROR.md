# Spotmap image mirror and size-bounded images

Status: API contract plus dry-run tooling. **Nothing has been pinned and no
database row has been changed.** External steps wait for review of the dry run
below and for the prerequisites at the end.

## Why

Dry run on 2026-10-29, from the public `GET /api/spotmap` (no credentials):

| | spots | notes |
|---|---|---|
| total | 631 | |
| no image | 59 | |
| `mymaps.usercontent.google.com` | 394 | PNG originals, 25 sampled: 0.4–16.6 MB, mean 5.9 MB, up to 4032×3024 |
| `lh3.googleusercontent.com` (`/umsh/`) | 115 | **112 of 112 unique sources return 403** (any UA/referer). 102 still have a working 400px small on IPFS; **10 spots have no working image at all** |
| `images.hive.blog` | 63 | durable and resizable via the Hive CDN; not mirrored |

The detail hero uses the full-size original (multi-MB PNG), which is a
memory risk on Android. The lh3 links show that Google-hosted URLs do expire,
so the My Maps originals should be preserved while they still resolve.

## Client contract (`/api/spotmap` and `/api/spotmap/[id]`)

Legacy fields are **unchanged**: `thumbnail` (and the raw row on the detail
route) and `thumbnail_small`, which still falls back to the full original
when no small exists.

New fields, always present (`src/lib/spotmap-medium.ts`):

| field | value | bound |
|---|---|---|
| `thumbnail_medium` | generated medium, else `null`. Never a small, never the original | long side ≤ 800px, measured before it is written |
| `thumbnail_bounded` | `thumbnail_medium`, else the stored small, else `null` | ≤ 800px or ≤ 400px |
| `thumbnail_bounded_kind` | `"medium"` \| `"small"` \| `null` | says which bound applies |

Clients that must not decode originals use `thumbnail_bounded`. On `null`
they show a placeholder, or opt in to `thumbnail` knowingly. Nothing in the
new fields can resolve to the original.

Before migration 0035 is applied, the list route retries without the column
(PostgREST `42703`), and every spot reports `thumbnail_medium: null` with the
small as `thumbnail_bounded`. The detail route uses `select *` and needs no
fallback.

## Schema

Canonical migration: `skatehive3.0/sql/migrations/0035_spotmap_medium_mirror.sql`
(draft web PR [#270](https://github.com/SkateHive/skatehive3.0/pull/270)).
It adds two nullable `text` columns to `public.spotmap_spots`,
`thumbnail_medium` and `image_original_mirror`, with no default, backfill or
index. The API-side record is
`src/lib/userbase/migrations/spotmap_medium_mirror.sql` (record only; do not
apply). Grip ran 7/7 PGlite compatibility, idempotency and rollback tests; it
has **not** been tested on a live PostgreSQL deployment.

## Tooling

`scripts/spotmap-image-mirror.ts` (`pnpm mirror:spot-images <step>`), with
the logic in `src/lib/spotmap-mirror.ts`:

| step | external effect | needs |
|---|---|---|
| `inventory` | public GET only | nothing (`--source db` needs `SUPABASE_USERBASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |
| `probe` | GETs to the image hosts, 25 MB cap + 30s timeout each, concurrency 2 | nothing |
| `estimate` | none | nothing |
| `execute --plan <hash>` | pins originals to Pinata; asks the transcoder for an ~800px medium, then fetches and measures it | `PINATA_JWT`, `IMAGE_THUMBNAIL_SERVICE_URL`, `THUMBNAIL_SHARED_SECRET` |
| `sql` | none (writes `apply.sql` + `rollback.sql` for review) | nothing |

Properties:
- **Dedup:** one item per unique source URL (506 items for 509 spots), and
  originals are deduped by sha256 before pinning.
- **Resumable/idempotent:** state lives in `.spotmap-mirror/manifest.json`
  (gitignored), written atomically after every item; re-running a step skips
  finished items; attempts are capped at 3.
- **Bounded:** downloads stream with a hard byte cap (Google ignores Range).
- **Medium verified:** each medium is fetched and its dimensions read. A
  medium whose long side is over `--medium-px` (default 800), or that is
  truncated or unreadable, marks the item `failed` and is dropped. Only
  verified mediums reach `apply.sql`.
- **Original preservation:** `thumbnail`, `thumbnail_override` and
  `thumbnail_small` are never written. Originals are pinned byte-for-byte.
- **Reviewed execution:** `execute` refuses to run unless `--plan` matches the
  hash of the current manifest's work.
- **No direct DB writes:** `sql` emits UPDATEs that touch only the two new
  columns, each guarded by the source URL it was planned from, plus a
  matching rollback.
- **Dead sources:** an unreachable original becomes `degraded` and writes
  **nothing**. A small is never stored as a medium; the API already serves it
  as `thumbnail_bounded` (kind `"small"`). The 10 spots with no small stay
  `failed` and are listed for manual follow-up.

## Estimated volume (from the dry run)

- Originals: ~2.3 GB (394 My Maps × 5.9 MB mean, from 25 samples).
- Mediums: ~56 MB at ~150 KB each (the existing 400px smalls are 17–43 KB).
- Pins: ~788 (one original + one medium per reachable My Maps source).
- Re-run `probe` on more items to tighten the estimate before the pilot.

## Sequence

Dependencies:
- **Pinata execute** (pinning originals, generating mediums) does not depend
  on the schema. It only writes to Pinata and to the local manifest, so it
  can technically run before or after 0035.
- **DB mapping apply** (`apply.sql`) writes the new columns, so 0035 **must**
  be applied first.

Order:
1. Merge the API contract. It's additive and works before and after 0035.
2. Prerequisites for a bounded pilot (both required):
   - The transcoder owner confirms `POST /image-thumbnail` honours
     `maxPx: 800` and states its output format. The existing smalls are JPEG
     with alpha dropped. `execute` measures every medium anyway.
   - Pinata plan headroom for ~2.3 GB / ~800 pins, and a decision on a
     separate Pinata group for originals.
3. Apply 0035 (web PR #270), checked on the live database.
4. Pilot: `execute --plan <hash> --limit 10`, then review the manifest,
   `apply.sql` and the measured medium sizes.
5. Apply the reviewed `apply.sql`, then check `thumbnail_bounded_kind:
   "medium"` on those spots.
6. Continue in batches with the same review loop.

## Rollback

- **Data, keeping the schema:** run the generated `rollback.sql`. It nulls
  only values the apply file set, and only where they still match.
- **Schema:** dropping the columns deletes their data, but **IPFS pins stay**
  and must be unpinned separately. Every pinned CID is in the manifest
  (`originalCid`, `mediumUrl`), so **keep the manifest**. The API falls back
  cleanly when the column is missing.
- `ALTER TABLE … DROP COLUMN` takes an `ACCESS EXCLUSIVE` lock on
  `spotmap_spots`. It's quick on a 631-row table but not lock-free, and it
  waits behind open transactions, so don't count on an instant rollback in
  production.
- **Restoring after a schema rollback:** re-apply the schema (0035) **first**,
  then replay `apply.sql`, which was regenerated from the kept manifest. The
  mapping SQL has nothing to write into until the columns exist again.
