import { isGatewayCidUrl } from "./validation";

// Reachability check for a video the browser uploaded to the transcoder. It
// proves the gateway serves a video at that CID now; it does NOT prove
// dimensions, duration or that the file is the one the user meant.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function checkVideoUrl(
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5000
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!isGatewayCidUrl(url)) return { ok: false, code: "invalid_media" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
    if (res.status >= 300 && res.status < 400) return { ok: false, code: "media_redirect" };
    if (res.status !== 200) return { ok: false, code: "media_unreachable" };
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("video/")) return { ok: false, code: "media_not_video" };
    return { ok: true };
  } catch {
    return { ok: false, code: "media_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
