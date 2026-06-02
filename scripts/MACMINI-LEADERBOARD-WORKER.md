# Leaderboard recompute worker (Mac Mini)

The leaderboard **recompute** (fetch Hive/Ethereum data → calculate points → upsert
to Supabase) is an expensive job that we do **not** want to run on Vercel. Instead it
runs on the Mac Mini on a schedule via `launchd`, reusing the exact logic from the API
([`src/app/api/cron/v2/recompute.ts`](../src/app/api/cron/v2/recompute.ts)).

Vercel keeps doing only the cheap part — serving the precomputed rows from Supabase via
`GET /api/v2/leaderboard`. The Vercel route `GET /api/cron/v2` remains as a
`CRON_SECRET`-protected manual/backup trigger but is **not** scheduled on Vercel.

```
Mac Mini (launchd, every 20 min)         Vercel (read-only)
  scripts/recompute-leaderboard.ts  ─┐      GET /api/v2/leaderboard ─┐
        │ writes                      │            ▲ reads           │
        ▼                             └──► Supabase ◄────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `scripts/recompute-leaderboard.ts` | The entrypoint. Loads env, takes a lock, runs the recompute. `--check` validates env + imports with no writes. |
| `scripts/run-recompute.sh` | launchd wrapper — sets up node in PATH, cd's to the repo, runs the script. |
| `scripts/launchd/app.skatehive.leaderboard-recompute.plist` | launchd job template (replace `__REPO_DIR__`). |

## One-time setup on the Mac Mini

```bash
# 0. Get the repo (or pull latest) and enter the service
cd /path/to/skatehive/monorepo/services/skatehive-api

# 1. Install deps (repo uses pnpm)
pnpm install

# 2. Provide env. The job needs the same secrets the API uses:
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    HAFSQL_SERVER, HAFSQL_DATABASE, HAFSQL_USER, HAFSQL_PWD, ALCHEMY_API_KEY
#    Put them in .env.local (see example.env). Pull from Vercel if you prefer:
#    vercel link && vercel env pull .env.local

# 3. Validate WITHOUT writing anything
pnpm run recompute:leaderboard -- --check
#   → expect "✓" for every env var and "--check OK: ... recompute importable (function)"

# 4. Create the log dir
mkdir -p logs

# 5. Install the launchd job (replace REPO with the absolute path from step 0)
REPO="$(pwd)"
sed "s#__REPO_DIR__#$REPO#g" scripts/launchd/app.skatehive.leaderboard-recompute.plist \
  > ~/Library/LaunchAgents/app.skatehive.leaderboard-recompute.plist
launchctl load -w ~/Library/LaunchAgents/app.skatehive.leaderboard-recompute.plist
```

`RunAtLoad` is true, so it runs once immediately. Watch it:

```bash
tail -f logs/recompute.log
```

## Operating it

```bash
# Run once by hand (real recompute)
pnpm run recompute:leaderboard

# Trigger now via launchd
launchctl start app.skatehive.leaderboard-recompute

# Stop / change schedule
launchctl unload ~/Library/LaunchAgents/app.skatehive.leaderboard-recompute.plist
# (edit StartInterval, then re-run sed + launchctl load -w)
```

- **Schedule:** `StartInterval` is seconds (default `1200` = 20 min). Each run processes
  the 50 stalest accounts; tune to community size.
- **Overlap protection:** the script takes a lock at `$TMPDIR/skatehive-leaderboard-recompute.lock`
  and skips (exit 0) if a fresh run is already in progress (stale after 30 min).
- **Failures:** non-zero exit on error; details in `logs/recompute.log`.
