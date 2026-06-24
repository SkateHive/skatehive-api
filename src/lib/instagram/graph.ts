/**
 * Instagram Graph API client for the shared @skatehive Business account.
 * Two-phase publish: create media container -> poll status -> media_publish.
 *
 * Supports an ORDERED LIST of credentials (host + token). The publish runs
 * end-to-end with the first config; on an AUTH-class failure (bad/expired token,
 * host/type mismatch) it retries the whole publish with the next config. Media
 * errors (format/fetch/rate-limit) do NOT fall back — same result, wasted quota.
 *
 * Config (Business Account ID is shared; only host+token vary):
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID            (required)
 *   INSTAGRAM_PAGE_ACCESS_TOKEN  + INSTAGRAM_GRAPH_HOST    (primary)
 *   INSTAGRAM_PAGE_ACCESS_TOKEN_2 + INSTAGRAM_GRAPH_HOST_2 (optional fallback)
 */

interface IgConfig {
  igUserId: string;
  accessToken: string;
  host: string;
  version: string;
}

// Normalize a host that may or may not include a scheme (new URL() needs one).
function normHost(h?: string): string {
  if (!h) return "https://graph.instagram.com";
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

function getConfigs(): IgConfig[] {
  const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const version = process.env.INSTAGRAM_GRAPH_API_VERSION || "v23.0";
  if (!igUserId) return [];
  const configs: IgConfig[] = [];
  const t1 = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  if (t1) configs.push({ igUserId, accessToken: t1, host: normHost(process.env.INSTAGRAM_GRAPH_HOST), version });
  const t2 = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN_2;
  if (t2) {
    configs.push({
      igUserId,
      accessToken: t2,
      host: normHost(process.env.INSTAGRAM_GRAPH_HOST_2 || process.env.INSTAGRAM_GRAPH_HOST),
      version,
    });
  }
  return configs;
}

export type PublishResult =
  | { success: true; containerId: string; mediaId: string; permalink?: string }
  | { success: false; error: string; authError?: boolean };

// Meta auth-class errors → worth retrying with a different credential.
function isAuthError(error: string | undefined): boolean {
  return /access token|oauth|cannot parse|session has expired|code 190\b/i.test(error || "");
}

// Meta transient errors → retry the SAME credential after a short backoff.
// 2207077 "Media could not be fetched" most often means the gateway/CDN isn't
// serving a freshly-pinned IPFS CID yet (it warms up within a few seconds);
// code 1/2 "unexpected error, please retry" and HTTP 5xx are Meta-side blips.
// These resolve on retry — proven live: a video that failed at post time
// published fine moments later, same CID, same account.
function isTransientError(error: string | undefined): boolean {
  return /could not be fetched|2207077|unexpected error|please (?:try again|retry)|temporar|timeout|timed out/i.test(
    error || ""
  );
}

const TRANSIENT_TRIES = 3;
const TRANSIENT_BASE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// POST /media with bounded retry on transient (non-auth) errors. Auth errors
// return immediately so withFailover can switch credentials; permanent media
// errors (aspect ratio, duration, format) return immediately — retrying them
// only wastes quota and time.
async function createContainerWithRetry(
  cfg: IgConfig,
  searchParams: Record<string, string>,
  label: string
): Promise<{ ok: true; id: string } | { ok: false; error: string; authError: boolean }> {
  let last: { ok: false; error: string; authError: boolean } = {
    ok: false,
    error: `Failed to create ${label}.`,
    authError: false,
  };
  for (let i = 0; i < TRANSIENT_TRIES; i++) {
    const res = await graphFetch(cfg, `/${cfg.igUserId}/media`, { method: "POST", searchParams });
    if (res.ok && res.data?.id) return { ok: true, id: res.data.id };
    const error = fbError(res.data, `Failed to create ${label}.`);
    last = { ok: false, error, authError: isAuthError(error) };
    if (last.authError || !isTransientError(error) || i === TRANSIENT_TRIES - 1) return last;
    await sleep(TRANSIENT_BASE_DELAY_MS * (i + 1)); // 2s, then 4s — lets a fresh CID warm up
  }
  return last;
}

// POST /media_publish with bounded retry on transient (non-auth) errors.
async function publishContainerWithRetry(
  cfg: IgConfig,
  containerId: string,
  label: string
): Promise<PublishResult> {
  let lastErr = `Failed to publish ${label}.`;
  let authError = false;
  for (let i = 0; i < TRANSIENT_TRIES; i++) {
    const res = await graphFetch(cfg, `/${cfg.igUserId}/media_publish`, {
      method: "POST",
      searchParams: { creation_id: containerId },
    });
    if (res.ok && res.data?.id) {
      const mediaId: string = res.data.id;
      return { success: true, containerId, mediaId, permalink: await fetchPermalink(cfg, mediaId) };
    }
    lastErr = fbError(res.data, `Failed to publish ${label}.`);
    authError = isAuthError(lastErr);
    if (authError || !isTransientError(lastErr) || i === TRANSIENT_TRIES - 1) break;
    await sleep(TRANSIENT_BASE_DELAY_MS * (i + 1));
  }
  return { success: false, error: lastErr, authError };
}

async function graphFetch(
  cfg: IgConfig,
  path: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = new URL(`${cfg.host}/${cfg.version}${path}`);
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", cfg.accessToken);
  const res = await fetch(url.toString(), { ...init, searchParams: undefined } as RequestInit);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

function fbError(data: any, fallback: string): string {
  return data?.error?.message || data?.error_user_msg || fallback;
}

function collaboratorParam(collaborators?: string[]): { collaborators: string } | {} {
  const cleaned = (collaborators ?? [])
    .map((c) => c.trim().replace(/^@/, "").toLowerCase())
    .filter((c) => /^[a-z0-9._]{1,30}$/.test(c))
    .slice(0, 3);
  if (!cleaned.length) return {};
  return { collaborators: JSON.stringify(cleaned) };
}

async function fetchPermalink(cfg: IgConfig, mediaId: string): Promise<string | undefined> {
  const res = await graphFetch(cfg, `/${mediaId}`, { searchParams: { fields: "permalink" } });
  if (res.ok && typeof res.data?.permalink === "string") return res.data.permalink;
  return undefined;
}

async function waitForContainerReady(
  cfg: IgConfig,
  containerId: string,
  timeoutMs: number,
  pollMs: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statusRes = await graphFetch(cfg, `/${containerId}`, {
      searchParams: { fields: "status_code,status" },
    });
    const code = statusRes.data?.status_code;
    if (code === "FINISHED") return { ok: true };
    if (code === "ERROR" || code === "EXPIRED") {
      return { ok: false, error: `IG container ${code}: ${statusRes.data?.status || "no detail"}` };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: `IG container did not finish within ${timeoutMs}ms` };
}

// Single-config attempts. `authError` lets the caller decide whether to fail over.
async function publishImageWith(
  cfg: IgConfig,
  input: { imageUrl: string; caption: string; collaborators?: string[] }
): Promise<PublishResult> {
  const created = await createContainerWithRetry(
    cfg,
    { image_url: input.imageUrl, caption: input.caption, ...collaboratorParam(input.collaborators) },
    "IG media container"
  );
  if (!created.ok) return { success: false, error: created.error, authError: created.authError };
  const ready = await waitForContainerReady(cfg, created.id, 30_000, 1500);
  if (!ready.ok) return { success: false, error: ready.error };
  return publishContainerWithRetry(cfg, created.id, "IG media");
}

async function publishReelWith(
  cfg: IgConfig,
  input: { videoUrl: string; caption: string; coverUrl?: string; collaborators?: string[] }
): Promise<PublishResult> {
  const created = await createContainerWithRetry(
    cfg,
    {
      media_type: "REELS",
      video_url: input.videoUrl,
      caption: input.caption,
      ...(input.coverUrl ? { cover_url: input.coverUrl } : {}),
      ...collaboratorParam(input.collaborators),
    },
    "IG Reel container"
  );
  if (!created.ok) return { success: false, error: created.error, authError: created.authError };
  const ready = await waitForContainerReady(cfg, created.id, 180_000, 4000);
  if (!ready.ok) return { success: false, error: ready.error };
  return publishContainerWithRetry(cfg, created.id, "IG Reel");
}

// Run a publish across configs, failing over only on auth-class errors.
async function withFailover(
  attempt: (cfg: IgConfig) => Promise<PublishResult>
): Promise<PublishResult> {
  const configs = getConfigs();
  if (!configs.length) {
    return { success: false, error: "Instagram cross-posting is not configured on the server." };
  }
  let last: PublishResult = { success: false, error: "No Instagram credentials" };
  for (let i = 0; i < configs.length; i++) {
    last = await attempt(configs[i]);
    if (last.success) return last;
    // Only try the next credential on an auth-class failure.
    if (!last.authError || i === configs.length - 1) return last;
  }
  return last;
}

export function publishImageToInstagram(input: {
  imageUrl: string;
  caption: string;
  collaborators?: string[];
}): Promise<PublishResult> {
  return withFailover((cfg) => publishImageWith(cfg, input));
}

export function publishReelToInstagram(input: {
  videoUrl: string;
  caption: string;
  coverUrl?: string;
  collaborators?: string[];
}): Promise<PublishResult> {
  return withFailover((cfg) => publishReelWith(cfg, input));
}

export function isInstagramConfigured(): boolean {
  return getConfigs().length > 0;
}
