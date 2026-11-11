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

## Post types

`publication_type` is explicit and immutable (migration 0043), separate from
`kind` (text/photo/video), and never inferred from media:

- `snap` (default; a missing field means snap, so older clients are unchanged):
  reply to the current `@peak.snaps` container, `title: ""`, body <= 5000.
- `article`: root post in the community: parent author `""` (EMPTY STRING,
  distinct from the legacy NULL) and parent permlink `hive-173115`; title
  1..120 and body 1..20000 required; the title goes on chain.

Same media rules for both. Cover = the first photo in `media` (article
`image[0]`); a video's poster stays in `thumbnail`. Request hash: unchanged for
snaps (old retries still match), prefixed with `article` for articles. The
legacy published blog (parent NULL) is classified `article` by 0043 without
any broadcast. `GET /community/posts/:id` returns a published post (public
fields, `publication_type`, `cover`) for the article page; 404 otherwise.
Rollout: 0043 first (current API keeps creating snaps), then this API, then
the site. With an older API on 0043, an article can never be published as a
snap: 0043's reserve_target rejects a mismatched destination before any
broadcast.

## Publishing

Posts are published as Skatehive **snaps**: a reply to the current
`@peak.snaps` container (latest root `snap-container-*`, resolved like the web
and mobile composers), `title: ""` (the original title opens the body), tags
`hive-173115`, `snaps`, `coletivoxv`. The target (author, signer kind, parent
author, parent permlink) is reserved in the DB by
`userbase_app_post_publish_reserve_target` (migration 0041) before any
broadcast and never changes; retries and reconciliation use only the saved
parent. A post at the destination counts as ours only if author, permlink,
parent and `json_metadata.coletivoxv.submission_id` all match. No container ->
no broadcast (`snap_container_unavailable`, retryable). A reservation from the
old root-post flow without a saved parent is never published blindly
(`legacy_target_unknown`). Rollout order: 0041 first, then this API, flag last.


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

## Engagement (read-only)

App credential only, no session; PUBLISHED coletivoxv posts only (destination
from the DB, never from the client; the legacy blog post works too). Read with
a bounded Hive RPC client (`src/lib/coletivo/hiveRpc.ts`: fetch with abort on
headers+body, 3 MiB streamed cap, at most 2 nodes, 4s each, outer signal), on
the post's OWN author/permlink, never the `@peak.snaps` container. The chain
post must carry `json_metadata.coletivoxv.submission_id` and the expected parent.

- `GET /engagement?ids=a,b` (1..24): `{items:{[id]:{votes_up, comments_total, updated_at}}, unavailable:[ids]}`.
  `votes_up` = distinct voters with `percent > 0`; `comments_total` = chain
  `children` = ALL replies (direct + nested, verified on real threads).
  Unknown/unpublished ids are absent; chain failures go to `unavailable` (never
  0); all failed -> 503. Concurrency 4, global deadline 8s that also aborts
  in-flight fetches. In-memory cache 30s (500 entries); `Cache-Control:
  private, max-age=15` (no CDN, so the credential check always runs).
- `GET /submissions/:id/comments?limit&cursor`: FIRST-LEVEL replies, oldest
  first, cursor on `(created, author, permlink)`; `total_replies` (all) and
  `direct_count` (first level); items `{id, author{handle, avatar_url},
  created_at (UTC ISO), body (raw, render as text), body_truncated, replies,
  votes_up, low_score}`. More than 1000 direct replies -> `partial: true` +
  `thread_url`. A malformed/foreign reply makes the list unavailable (503),
  never silently dropped; unknown/unpublished -> 404 without the destination.
