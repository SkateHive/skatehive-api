import { describe, expect, it } from "vitest";
import { checkVideoUrl } from "./mediaCheck";

const URL_OK = "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44);
const resp = (status: number, type = "video/mp4") =>
  new Response(null, { status, headers: { "content-type": type } });

describe("checkVideoUrl", () => {
  it("accepts a reachable video and sends HEAD with redirect=manual", async () => {
    let init: RequestInit | undefined;
    const r = await checkVideoUrl(URL_OK, async (_u, i) => ((init = i), resp(200)));
    expect(r).toEqual({ ok: true });
    expect(init).toMatchObject({ method: "HEAD", redirect: "manual" });
  });
  it("refuses redirects, non-video, errors, timeouts and foreign URLs", async () => {
    expect(await checkVideoUrl(URL_OK, async () => resp(302))).toEqual({ ok: false, code: "media_redirect" });
    expect(await checkVideoUrl(URL_OK, async () => resp(200, "text/html"))).toEqual({ ok: false, code: "media_not_video" });
    expect(await checkVideoUrl(URL_OK, async () => resp(404))).toEqual({ ok: false, code: "media_unreachable" });
    expect(await checkVideoUrl(URL_OK, async () => { throw new Error("x"); })).toEqual({ ok: false, code: "media_unreachable" });
    const hang = (_u: string, i: RequestInit) =>
      new Promise<Response>((_, rej) => i.signal!.addEventListener("abort", () => rej(new Error("abort"))));
    expect(await checkVideoUrl(URL_OK, hang, 20)).toEqual({ ok: false, code: "media_unreachable" });
    expect(await checkVideoUrl("https://evil.example/v.mp4", async () => resp(200))).toEqual({ ok: false, code: "invalid_media" });
  });
});
