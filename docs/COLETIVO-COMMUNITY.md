# Coletivo XV community API

Submissions, moderation and Hive publishing for the Coletivo XV site
(partner app `coletivoxv`). Code: `src/lib/coletivo`, routes under
`/api/userbase/apps/coletivoxv/community`.

## Rollout order

1. Apply skatehive3.0 `sql/migrations/0038_userbase_app_posts.sql` (owner, with
   its pre/postflight). The routes call its RPCs; without it they return 503.
2. Deploy this API with `COLETIVO_HIVE_PUBLISH_ENABLED` **unset**. Approvals
   leave posts `approved`; nothing is broadcast.
3. Bind moderators (wilbor, xvlad) through the challenge flow below.
4. After review, set `COLETIVO_HIVE_PUBLISH_ENABLED=1` (production) and redeploy.
   Then use "resume" once to publish posts approved while it was off.

Rollback: unset the flag and redeploy (stops broadcasting); posts stay
`approved`. Schema rollback is Grip's 0038 rollback.

## Auth

- Every route: `X-Skatehive-App-Id: coletivoxv` + `X-Skatehive-App-Secret`
  (+ `X-Skatehive-End-User-Ip`), server to server.
- Session routes: `Authorization: Bearer <coletivoxv app session token>`. Only
  its sha256 reaches the DB, which resolves the user and the email it was
  issued through. First-party Skatehive sessions are never accepted.
- Moderator = DB allowlist (`userbase_app_moderator_allowlist`) AND the in-code
  list (`src/lib/coletivo/config.ts`: wilbor, xvlad), AND a binding made by
  signing a fresh, single-use challenge with the account's posting key. It is
  tied to user + email. `verified_at` is never used. pharraxv is off (no such
  Hive account yet).

## Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/me` | session |
| POST | `/media/image` (multipart `file`, jpeg/png/webp, <= 4MB) | session |
| POST | `/submissions` (+ `Idempotency-Key`) | session |
| GET | `/submissions/mine?cursor&limit` | session |
| GET | `/submissions/:id` | owner or moderator |
| POST | `/moderator/challenge`, `/moderator/verify` | session |
| GET | `/queue?status&cursor&limit` | moderator |
| POST | `/submissions/:id/approve`, `/reject` (`reason`) | moderator |
| POST | `/submissions/:id/publish` (retry) | moderator |
| POST | `/maintenance/resume` | moderator |
| GET | `/feed?context_kind&context_slug&cursor&limit` | app credential only |

Errors: `{ success: false, code, error }` with codes only (no DB messages).

**Types.** Submission: text OR media. Media: `image` from `images.hive.blog`
(our upload) or `video` as `https://ipfs.skatehive.app/ipfs/<CID>` with an
optional poster; at most 10 items, at most 1 video. Context:
`{ kind: "instalacao" | "evento", slug }` (format only; the site validates the
list). Statuses: `pending → approved → publishing → published`, or `rejected`,
or `failed` (retry via `/publish`, except `signer_changed` /
`destination_conflict`).

**Withdrawn posts.** A post the author withdraws is moved by an audited owner
action from `approved` to `failed` with `last_error_code=withdrawn_by_author`
(the 0038 guard allows it; an event is logged). `/publish` refuses such a post
with `409 withdrawn` before any requeue, and resume/cron never pick `failed`.

**Cursor.** Opaque base64url of `(timestamp, id)`, ordered
`(ts desc, id desc)`: `created_at` for mine/queue, `published_at` for the feed.
`limit` 1..50, default 20.

## Publishing

Approval starts publishing right after the response (`after()`); the UI polls
`GET /submissions/:id`. The post is signed as the author (their stored key, or
the shared `DEFAULT_HIVE_POSTING_ACCOUNT`, with attribution in
`userbase_soft_posts`). The DB fixes the permlink at insert and reserves the
author before any broadcast. The chain is checked (by `submission_id` in
`json_metadata`) before and after any error, so a timed-out broadcast is
reconciled, not repeated.

Follow-ups (soft-post attribution, Instagram curation request) run from the DB
outbox and never touch Hive. The Instagram request is idempotent by lookup
(any status) + the queue's active unique index; see
`src/lib/coletivo/crosspostOnce.ts` for the documented residual window.

## Recovery (nothing scheduled)

- `POST /maintenance/resume` (moderator): picks up approved posts and expired
  publish leases (never requeues `failed`), then drains due follow-ups. At most
  5 posts; soft budget of 20s (no new work after it, in-flight calls have 5s
  timeouts).
- `GET /api/cron/coletivo-resume` with `Authorization: Bearer $CRON_SECRET`
  (>= 16 chars): same work. NOT in `vercel.json`; add a schedule only after the
  plan/cost review.

## Media limits

- Photos go through this API (Vercel body limit), <= 4MB, type checked by magic
  bytes; the server hashes and signs the upload itself.
- Video uploads go from the browser straight to `transcode.skatehive.app`.
  **Blocked today for coletivoxv.org by the transcoder's CORS** (its
  `ALLOWED_ORIGINS` needs `https://coletivoxv.org` and `https://www.coletivoxv.org`;
  infra owner). Until then a video is only accepted as an existing gateway CID
  URL, checked with HEAD, no redirects, 5s timeout, `video/*`. Dimensions are not
  verified.
- Everything uploaded is public (images.hive.blog / IPFS) even if the
  submission is later rejected.
