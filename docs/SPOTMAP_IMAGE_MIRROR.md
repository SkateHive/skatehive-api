# Spotmap image mirror and medium variant

Status: tooling and API contract only. **Nothing has been pinned and no
database row has been changed.** External steps wait for review of the dry run
below.

## Why

Dry run on 2026-10-29, from the public `GET /api/spotmap` (no credentials):

| | spots | notes |
|---|---|---|
| total | 631 | |
| no image | 59 | |
| `mymaps.usercontent.google.com` | 394 | PNG originals, 25 sampled: 0.4–16.6 MB, mean 5.9 MB, up to 4032×3024 |
| `lh3.googleusercontent.com` (`/umsh/`) | 115 | **112 of 112 unique sources return 403** (any UA/referer). 102 still have a working 400px small on IPFS; **10 spots have no working image at all** |
| `images.hive.blog` | 63 | durable and resizable via the Hive CDN; not mirrored |

The detail hero uses the full-size original (multi-MB PNG). The lh3 links
show that Google-hosted URLs do expire, so the My Maps originals should be
preserved while they still resolve.

## What this PR adds

- `thumbnail_medium` in `GET /api/spotmap` and `GET /api/spotmap/[id]`.
  Always present: the medium once it exists, otherwise the same full image
  (`thumbnail_override || thumbnail`). Clients can switch now. The list route
  retries without the column if the migration isn't applied yet (PostgREST
  `42703`), so the API works before and after it.
- Migration record `src/lib/userbase/migrations/spotmap_medium_mirror.sql`
  (`thumbnail_medium`, `image_original_mirror`). The canonical copy belongs in
  `skatehive3.0/sql/migrations`, because `spotmap_spots` is web-owned schema.
- `scripts/spotmap-image-mirror.ts` (`pnpm mirror:spot-images <step>`), logic
  in `src/lib/spotmap-mirror.ts`:

| step | external effect | needs |
|---|---|---|
| `inventory` | public GET only | nothing (`--source db` needs `SUPABASE_USERBASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |
| `probe` | GETs to the image hosts, 25 MB cap + 30s timeout each, concurrency 2 | nothing |
| `estimate` | none | nothing |
| `execute --plan <hash>` | pins originals to Pinata; asks the transcoder for an ~800px medium | `PINATA_JWT`, `IMAGE_THUMBNAIL_SERVICE_URL`, `THUMBNAIL_SHARED_SECRET` |
| `sql` | none (writes `apply.sql` + `rollback.sql` for review) | nothing |

Properties:
- **Dedup:** one item per unique source URL (506 items for 509 spots), and
  originals are deduped by sha256 before pinning.
- **Resumable/idempotent:** state lives in `.spotmap-mirror/manifest.json`
  (gitignored), written atomically after every item; re-running a step skips
  finished items; attempts are capped at 3.
- **Bounded:** downloads stream with a hard byte cap (Google ignores Range).
- **Original preservation:** `thumbnail` / `thumbnail_override` are never
  written. Originals are pinned byte-for-byte.
- **Reviewed execution:** `execute` refuses to run unless `--plan` matches the
  hash of the current manifest's work, so it runs exactly what was reviewed.
- **No direct DB writes:** `sql` emits UPDATEs that touch only the two new
  columns, each guarded by the source URL it was planned from, plus a
  matching rollback.
- **Dead sources:** an unreachable original becomes `degraded`, and its
  medium is set to the existing 400px small (no new pin). The 10 spots with
  no small stay `failed` and are listed for manual follow-up.

## Estimated volume (from the dry run)

- Originals: ~2.3 GB (394 My Maps × 5.9 MB mean, from 25 samples).
- Mediums: ~56 MB at ~150 KB each (the existing 400px smalls are 17–43 KB).
- Pins: ~788 (one original + one medium per reachable My Maps source).
- Re-run `probe` on more items to tighten the estimate before execute.

## Open questions before execute

1. Transcoder `POST /image-thumbnail`: does it honour `maxPx: 800`, or clamp
   to 400? What format does it output? The existing smalls are JPEG, and
   alpha is dropped. Its source isn't in this repo, so this needs the worker
   owner.
2. Pinata plan headroom for ~2.3 GB / ~800 pins, and whether originals
   should go to a separate Pinata group.
3. Whether to pin originals at all, or only mediums. Mediums alone are
   ~56 MB, but the originals would then still be lost if Google expires the
   My Maps URLs.

## Rollback

- Data: run the generated `rollback.sql`. It clears only values the apply file
  set.
- Schema: drop the two columns; the API falls back automatically.
- Pins: every pinned CID is in the manifest (`originalCid`), so they can be
  unpinned.
