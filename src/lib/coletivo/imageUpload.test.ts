import { describe, expect, it, vi } from "vitest";
import { PrivateKey } from "@hiveio/dhive";
import { sniffImage, uploadImage } from "./imageUpload";

const key = PrivateKey.fromSeed("img-test").toString();
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const ok = (url: string) => new Response(JSON.stringify({ url }), { status: 200 });

describe("image upload", () => {
  it("sniffs real types, not the declared one", () => {
    expect(sniffImage(jpeg)?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a....."))).toBeNull();
  });

  it("signs a server-computed hash and uploads to images.hive.blog under the signer", async () => {
    const fetchImpl = vi.fn(async () => ok("https://images.hive.blog/DQmX/image.jpg"));
    const r = await uploadImage(jpeg, { author: "skateuser", key }, fetchImpl);
    expect(r).toEqual({ ok: true, url: "https://images.hive.blog/DQmX/image.jpg" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/images\.hive\.blog\/skateuser\/[0-9a-f]{130}$/);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
  });

  it("refuses empty/oversize/unsupported, and odd host responses", async () => {
    const fetchImpl = vi.fn(async () => ok("https://evil.example/x.jpg"));
    expect(await uploadImage(Buffer.alloc(0), { author: "a", key }, fetchImpl)).toMatchObject({ ok: false, code: "image_too_large" });
    expect(await uploadImage(Buffer.concat([jpeg, Buffer.alloc(4 * 1024 * 1024)]), { author: "a", key }, fetchImpl)).toMatchObject({ code: "image_too_large" });
    expect(await uploadImage(Buffer.from("not an image at all"), { author: "a", key }, fetchImpl)).toMatchObject({ code: "unsupported_image" });
    expect(await uploadImage(jpeg, { author: "a", key }, fetchImpl)).toMatchObject({ code: "image_host_bad_response" });
    expect(await uploadImage(jpeg, { author: "a", key }, async () => new Response("no", { status: 500 }))).toMatchObject({ code: "image_host_rejected" });
    expect(await uploadImage(jpeg, { author: "a", key }, async () => { throw new Error("net"); })).toMatchObject({ code: "image_upload_failed" });
  });
});
