import { NextResponse } from 'next/server';
import { TRANSCODE_SERVICES } from '../transcode/config';

export const dynamic = 'force-dynamic';

type HealthStatus = 'operational' | 'degraded' | 'down';

// Probe kinds for external dependencies that don't expose a /healthz JSON endpoint.
type ProbeKind = 'hive-rpc' | 'eth-rpc' | 'supabase' | 'pinata';

type ServiceDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  healthUrl: string;
  priority?: number;
  headers?: Record<string, string>;
  probe?: ProbeKind;
};

type ServiceHealth = ServiceDefinition & {
  isHealthy: boolean;
  responseTime?: number;
  error?: string;
  lastChecked: string;
  cookieInfo?: {
    valid: boolean;
    exists: boolean;
    expiresAt?: string;
    daysUntilExpiry?: number;
  };
};

const HEALTH_TIMEOUT_MS = 5000;
// Slow down health polling to avoid 429s on rate-limited services
const CACHE_TTL_MS = 300000;

const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    id: 'macmini-insta',
    name: 'Mac Mini IG',
    category: 'Instagram Downloader',
    description: 'Mac Mini Instagram downloader / helper',
    healthUrl: 'https://minivlad.tail83ea3e.ts.net/instagram/healthz',
  },
  ...TRANSCODE_SERVICES.map((service) => ({
    id: `transcode-${service.priority}`,
    name: service.name,
    category: 'Video Transcoding',
    description: `${service.name} video transcoding node`,
    healthUrl: service.healthUrl,
    priority: service.priority,
  })),

  // ---- External dependencies (third-party infra Skatehive relies on) ----
  {
    id: 'hive-deathwing',
    name: 'Hive · deathwing',
    category: 'Hive RPC',
    description: 'Hive blockchain RPC node',
    healthUrl: 'https://api.deathwing.me',
    probe: 'hive-rpc',
    priority: 1,
  },
  {
    id: 'hive-blog',
    name: 'Hive · hive.blog',
    category: 'Hive RPC',
    description: 'Hive blockchain RPC node',
    healthUrl: 'https://api.hive.blog',
    probe: 'hive-rpc',
    priority: 2,
  },
  {
    id: 'hive-techcoderx',
    name: 'Hive · techcoderx',
    category: 'Hive RPC',
    description: 'Hive blockchain RPC node',
    healthUrl: 'https://techcoderx.com',
    probe: 'hive-rpc',
    priority: 3,
  },
  {
    id: 'base-rpc',
    name: 'Base Mainnet',
    category: 'Web3 / EVM',
    description: 'Base L2 RPC (DAO, NFTs, $token)',
    healthUrl: 'https://mainnet.base.org',
    probe: 'eth-rpc',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Database',
    description: 'Postgres · leaderboard / identities',
    healthUrl: `${(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1/health`,
    probe: 'supabase',
  },
  {
    id: 'pinata',
    name: 'Pinata / IPFS',
    category: 'Storage',
    description: 'IPFS pinning + media gateway',
    healthUrl: process.env.PINATA_JWT
      ? 'https://api.pinata.cloud/data/testAuthentication'
      : 'https://ipfs.skatehive.app',
    probe: 'pinata',
  },
];

const ALL_SERVICES = SERVICE_DEFINITIONS;

const healthCache: Record<string, ServiceHealth> = {};

// Build a ServiceHealth result, merging the service definition with probe outcome.
function buildResult(
  service: ServiceDefinition,
  isHealthy: boolean,
  startTime: number,
  error?: string
): ServiceHealth {
  return {
    ...service,
    isHealthy,
    responseTime: Date.now() - startTime,
    error: isHealthy ? undefined : error,
    lastChecked: new Date().toISOString(),
  };
}

// Probe an external dependency that has no shared /healthz contract.
async function probeExternal(
  service: ServiceDefinition,
  signal: AbortSignal,
  startTime: number
): Promise<ServiceHealth> {
  const jsonRpc = (method: string) =>
    fetch(service.healthUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
      signal,
    });

  switch (service.probe) {
    case 'hive-rpc': {
      const res = await jsonRpc('condenser_api.get_dynamic_global_properties');
      if (!res.ok) return buildResult(service, false, startTime, `HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const head = data?.result?.head_block_number;
      return head > 0
        ? buildResult(service, true, startTime)
        : buildResult(service, false, startTime, 'No head block in response');
    }

    case 'eth-rpc': {
      const res = await jsonRpc('eth_blockNumber');
      if (!res.ok) return buildResult(service, false, startTime, `HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return typeof data?.result === 'string'
        ? buildResult(service, true, startTime)
        : buildResult(service, false, startTime, 'No block number in response');
    }

    case 'supabase': {
      if (!service.healthUrl.startsWith('http')) {
        return buildResult(service, false, startTime, 'SUPABASE_URL not configured');
      }
      const anon =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      const res = await fetch(service.healthUrl, {
        headers: anon ? { apikey: anon } : undefined,
        signal,
      });
      return res.ok
        ? buildResult(service, true, startTime)
        : buildResult(service, false, startTime, `HTTP ${res.status} ${res.statusText}`);
    }

    case 'pinata': {
      const jwt = process.env.PINATA_JWT;
      const res = await fetch(service.healthUrl, {
        method: jwt ? 'GET' : 'HEAD',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
        signal,
      });
      // Authenticated check expects 200; gateway reachability accepts anything < 500.
      const ok = jwt ? res.ok : res.status < 500;
      return ok
        ? buildResult(service, true, startTime)
        : buildResult(service, false, startTime, `HTTP ${res.status} ${res.statusText}`);
    }

    default:
      return buildResult(service, false, startTime, 'Unknown probe');
  }
}

async function checkHealth(service: ServiceDefinition): Promise<ServiceHealth> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    if (service.probe) {
      const result = await probeExternal(service, controller.signal, startTime);
      clearTimeout(timeoutId);
      return result;
    }

    const response = await fetch(service.healthUrl, {
      signal: controller.signal,
      headers: service.headers,
    });
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        ...service,
        isHealthy: false,
        responseTime,
        error: `HTTP ${response.status} ${response.statusText}`,
        lastChecked: new Date().toISOString(),
      };
    }

    const data = await response.json().catch(() => ({}));

    // Special handling for Instagram services to extract cookie information
    if (service.category === 'Instagram Downloader' && data.authentication) {
      const auth = data.authentication;
      const cookieInfo = {
        valid: auth.cookies_valid === true,
        exists: auth.cookies_exist === true,
        expiresAt: auth.cookie_expires_at,
        daysUntilExpiry: auth.days_until_expiry,
      };

      const okFlag = data.ok === true || data.healthy === true || data.status === 'ok';
      return {
        ...service,
        isHealthy: okFlag || response.ok,
        responseTime,
        lastChecked: new Date().toISOString(),
        cookieInfo,
        error: !cookieInfo.valid && cookieInfo.exists
          ? `Invalid Instagram cookies${cookieInfo.daysUntilExpiry !== undefined ? ` (expires in ${cookieInfo.daysUntilExpiry} days)` : ''}`
          : !cookieInfo.exists
            ? 'Instagram cookies missing'
            : okFlag ? undefined : 'Health endpoint did not report ok',
      };
    }

    const okFlag = data.ok === true || data.healthy === true || data.status === 'ok';
    return {
      ...service,
      isHealthy: okFlag || response.ok,
      responseTime,
      lastChecked: new Date().toISOString(),
      error: okFlag ? undefined : 'Health endpoint did not report ok',
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      ...service,
      isHealthy: false,
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString(),
    };
  }
}

async function getServiceHealth(service: ServiceDefinition): Promise<ServiceHealth> {
  const cached = healthCache[service.id];
  const now = Date.now();

  if (cached && now - new Date(cached.lastChecked).getTime() < CACHE_TTL_MS) {
    return cached;
  }

  const result = await checkHealth(service);
  healthCache[service.id] = result;
  return result;
}

function getSystemStatus(services: ServiceHealth[]): HealthStatus {
  const healthyCount = services.filter((s) => s.isHealthy).length;
  if (healthyCount === services.length) return 'operational';
  if (healthyCount > 0) return 'degraded';
  return 'down';
}

export async function GET() {
  try {
    const results = await Promise.all(ALL_SERVICES.map((service) => getServiceHealth(service)));
    const status = getSystemStatus(results);

    const sortedResults = results.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(
      {
        status,
        timestamp: new Date().toISOString(),
        summary: {
          healthy: results.filter((r) => r.isHealthy).length,
          total: results.length,
        },
        services: sortedResults,
      },
      { status: status === 'down' ? 503 : 200 }
    );
  } catch (error) {
    console.error('Status check failed:', error);
    return NextResponse.json(
      {
        status: 'down',
        timestamp: new Date().toISOString(),
        error: 'Failed to collect service health',
      },
      { status: 500 }
    );
  }
}
