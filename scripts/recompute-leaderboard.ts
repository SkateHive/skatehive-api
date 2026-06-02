/**
 * Standalone leaderboard recompute job — meant to run on the Mac Mini via launchd,
 * NOT on Vercel. It reuses the exact recompute logic from the API
 * (src/app/api/cron/v2/recompute.ts), reads from Hive/Ethereum, computes points,
 * and upserts to Supabase. Vercel only ever serves the result via /api/v2/leaderboard.
 *
 * Usage:
 *   npm run recompute:leaderboard           # run the recompute
 *   npm run recompute:leaderboard -- --check # validate env + imports only (no writes)
 *
 * Exit codes: 0 = success / skipped, 1 = failure.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Load env from the repo root. Real environment vars (e.g. launchd) win, then
// .env.local, then .env — dotenv never overrides an already-set variable.
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });

const CHECK_ONLY = process.argv.includes('--check');
const LOCK_PATH = path.join(os.tmpdir(), 'skatehive-leaderboard-recompute.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // a run is presumed dead after 30 min

const ts = () => new Date().toISOString();
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);

// Env vars the recompute depends on (Supabase write target + data sources).
const REQUIRED_ENV = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'HAFSQL_SERVER',
    'HAFSQL_DATABASE',
    'HAFSQL_USER',
    'HAFSQL_PWD',
    'ALCHEMY_API_KEY',
];

function reportEnv(): string[] {
    const missing: string[] = [];
    for (const key of REQUIRED_ENV) {
        const present = !!process.env[key];
        log(`  env ${present ? '✓' : '✗'} ${key}`);
        if (!present) missing.push(key);
    }
    return missing;
}

function acquireLock(): boolean {
    try {
        if (fs.existsSync(LOCK_PATH)) {
            const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
            if (age < LOCK_STALE_MS) {
                const owner = fs.readFileSync(LOCK_PATH, 'utf8').trim();
                log(`another recompute appears to be running (lock: ${owner}, age ${Math.round(age / 1000)}s) — skipping`);
                return false;
            }
            log('found a stale lock — overriding');
        }
        fs.writeFileSync(LOCK_PATH, `pid=${process.pid} started=${ts()}`);
        return true;
    } catch (e) {
        log(`failed to acquire lock: ${e instanceof Error ? e.message : e}`);
        return false;
    }
}

function releaseLock() {
    try {
        if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
    } catch {
        /* best effort */
    }
}

async function main() {
    log(`leaderboard recompute starting (cwd=${process.cwd()}, check=${CHECK_ONLY})`);

    const missing = reportEnv();

    // Importing the recompute module also validates the whole import chain
    // (path aliases, Supabase/Hive/ETH clients) under tsx.
    const { updateLeaderboardData } = await import('@/app/api/cron/v2/recompute');

    if (CHECK_ONLY) {
        if (missing.length) {
            log(`--check FAILED: missing env: ${missing.join(', ')}`);
            process.exit(1);
        }
        log(`--check OK: env present, recompute importable (${typeof updateLeaderboardData})`);
        process.exit(0);
    }

    if (missing.length) {
        log(`refusing to run: missing required env: ${missing.join(', ')}`);
        process.exit(1);
    }

    if (!acquireLock()) {
        process.exit(0); // not an error — another run owns the work
    }

    try {
        const updated = await updateLeaderboardData();
        log(`recompute finished — ${updated ? updated.length : 0} accounts updated`);
        process.exit(0);
    } catch (e) {
        log(`recompute FAILED: ${e instanceof Error ? e.stack || e.message : e}`);
        process.exit(1);
    } finally {
        releaseLock();
    }
}

main().catch((e) => {
    log(`fatal: ${e instanceof Error ? e.stack || e.message : e}`);
    releaseLock();
    process.exit(1);
});
