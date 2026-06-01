import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Worker log endpoints. These return raw logs that include IPs, usernames,
// filenames, CIDs and URLs — this route proxies them and strips anything
// sensitive before exposing it publicly.
const LOG_SOURCES = [
  {
    id: 'macmini-video',
    name: 'Mac Mini · video',
    type: 'transcode' as const,
    url: 'https://minivlad.tail83ea3e.ts.net/video/logs?limit=25',
  },
  {
    id: 'oracle-video',
    name: 'Oracle · video',
    type: 'transcode' as const,
    url: 'https://transcode.skatehive.app/logs?limit=25',
  },
  {
    id: 'macmini-ig',
    name: 'Mac Mini · instagram',
    type: 'instagram' as const,
    url: 'https://minivlad.tail83ea3e.ts.net/instagram/logs?limit=25',
  },
];

const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 30000;
const MAX_ENTRIES = 60;

type SourceType = 'transcode' | 'instagram';

type SafeEntry = {
  source: string;
  type: SourceType;
  time: string;
  status: string;
  success: boolean | null; // null = in progress / unknown
  durationMs?: number;
  sizeBytes?: number;
  user: string; // masked
  fileExt?: string;
  shortCid?: string;
  platform?: string;
};

type SourceSummary = {
  id: string;
  name: string;
  type: SourceType;
  reachable: boolean;
  total?: number;
  successful?: number;
  failed?: number;
  inProgress?: number;
  successRate?: number;
  error?: string;
};

type LogsResponse = {
  timestamp: string;
  sources: SourceSummary[];
  entries: SafeEntry[];
};

let cache: { at: number; payload: LogsResponse } | null = null;

// --- sanitizers -----------------------------------------------------------

function maskUser(raw: unknown): string {
  const u = typeof raw === 'string' ? raw.trim() : '';
  if (!u || u.toLowerCase() === 'anonymous' || u.toLowerCase() === 'unknown') {
    return 'anon';
  }
  if (u.length <= 2) return `${u[0]}*`;
  return `${u.slice(0, 2)}${'*'.repeat(Math.min(u.length - 2, 4))}`;
}

function fileExt(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = raw.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

// CIDs reference public IPFS content but are still truncated to avoid handing
// out a clean copy-paste content map.
function shortCid(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length < 12) return undefined;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

function num(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function deriveSuccess(status: string, successField: unknown): boolean | null {
  if (typeof successField === 'boolean') return successField;
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'success' || s === 'ok') return true;
  if (s === 'failed' || s === 'error') return false;
  return null; // started / in-progress / unknown
}

function sanitizeEntry(
  source: string,
  type: SourceType,
  raw: Record<string, unknown>
): SafeEntry | null {
  const time =
    (raw.timestamp as string) || (raw.time as string) || (raw.date as string);
  if (!time) return null;

  const status = String(raw.status ?? 'unknown');
  return {
    source,
    type,
    time,
    status,
    success: deriveSuccess(status, raw.success),
    durationMs: num(raw.duration),
    sizeBytes: num(raw.fileSize) ?? num(raw.bytes),
    user: maskUser(raw.user),
    fileExt: fileExt(raw.filename),
    shortCid: shortCid(raw.cid),
    platform: typeof raw.platform === 'string' ? raw.platform : undefined,
  };
}

// --- fetch + normalize ----------------------------------------------------

async function fetchSource(
  src: (typeof LOG_SOURCES)[number]
): Promise<{ summary: SourceSummary; entries: SafeEntry[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        summary: { id: src.id, name: src.name, type: src.type, reachable: false, error: `HTTP ${res.status}` },
        entries: [],
      };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const rawLogs = Array.isArray(data.logs) ? (data.logs as Record<string, unknown>[]) : [];
    const entries = rawLogs
      .map((entry) => sanitizeEntry(src.id, src.type, entry))
      .filter((e): e is SafeEntry => e !== null);

    // Two stat shapes: video → { stats: {...} }, instagram → { success_count, ... }
    const stats = (data.stats as Record<string, unknown>) || {};
    const summary: SourceSummary = {
      id: src.id,
      name: src.name,
      type: src.type,
      reachable: true,
      total: num(stats.total) ?? num(data.total),
      successful: num(stats.successful) ?? num(data.success_count),
      failed: num(stats.failed) ?? num(data.failure_count),
      inProgress: num(stats.inProgress),
      successRate: num(stats.successRate),
    };
    return { summary, entries };
  } catch (error) {
    clearTimeout(timeout);
    return {
      summary: {
        id: src.id,
        name: src.name,
        type: src.type,
        reachable: false,
        error: error instanceof Error ? error.message : 'fetch failed',
      },
      entries: [],
    };
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  const results = await Promise.all(LOG_SOURCES.map(fetchSource));
  const entries = results
    .flatMap((r) => r.entries)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, MAX_ENTRIES);

  const payload: LogsResponse = {
    timestamp: new Date().toISOString(),
    sources: results.map((r) => r.summary),
    entries,
  };

  cache = { at: now, payload };
  return NextResponse.json(payload);
}
