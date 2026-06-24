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
  const containerRes = await graphFetch(cfg, `/${cfg.igUserId}/media`, {
    method: "POST",
    searchParams: { image_url: input.imageUrl, caption: input.caption, ...collaboratorParam(input.collaborators) },
  });
  if (!containerRes.ok || !containerRes.data?.id) {
    const error = fbError(containerRes.data, "Failed to create IG media container.");
    return { success: false, error, authError: isAuthError(error) };
  }
  const containerId: string = containerRes.data.id;
  const ready = await waitForContainerReady(cfg, containerId, 30_000, 1500);
  if (!ready.ok) return { success: false, error: ready.error };
  const publishRes = await graphFetch(cfg, `/${cfg.igUserId}/media_publish`, {
    method: "POST",
    searchParams: { creation_id: containerId },
  });
  if (!publishRes.ok || !publishRes.data?.id) {
    const error = fbError(publishRes.data, "Failed to publish IG media.");
    return { success: false, error, authError: isAuthError(error) };
  }
  const mediaId: string = publishRes.data.id;
  return { success: true, containerId, mediaId, permalink: await fetchPermalink(cfg, mediaId) };
}

async function publishReelWith(
  cfg: IgConfig,
  input: { videoUrl: string; caption: string; coverUrl?: string; collaborators?: string[] }
): Promise<PublishResult> {
  const containerRes = await graphFetch(cfg, `/${cfg.igUserId}/media`, {
    method: "POST",
    searchParams: {
      media_type: "REELS",
      video_url: input.videoUrl,
      caption: input.caption,
      ...(input.coverUrl ? { cover_url: input.coverUrl } : {}),
      ...collaboratorParam(input.collaborators),
    },
  });
  if (!containerRes.ok || !containerRes.data?.id) {
    const error = fbError(containerRes.data, "Failed to create IG Reel container.");
    return { success: false, error, authError: isAuthError(error) };
  }
  const containerId: string = containerRes.data.id;
  const ready = await waitForContainerReady(cfg, containerId, 180_000, 4000);
  if (!ready.ok) return { success: false, error: ready.error };
  const publishRes = await graphFetch(cfg, `/${cfg.igUserId}/media_publish`, {
    method: "POST",
    searchParams: { creation_id: containerId },
  });
  if (!publishRes.ok || !publishRes.data?.id) {
    const error = fbError(publishRes.data, "Failed to publish IG Reel.");
    return { success: false, error, authError: isAuthError(error) };
  }
  const mediaId: string = publishRes.data.id;
  return { success: true, containerId, mediaId, permalink: await fetchPermalink(cfg, mediaId) };
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
