import crypto from "crypto";
import { PrivateKey } from "@hiveio/dhive";
import { LIMITS } from "./config";

// Photo upload for Coletivo submissions: the API receives the bytes, checks the
// real type from magic bytes, hashes them ITSELF and signs Hive's image
// challenge with the author's signer (own key or the shared default account),
// then uploads to images.hive.blog. A client-supplied hash is never signed:
// signing arbitrary digests with a posting key could sign a transaction.

export type ImageSigner = { author: string; key: string };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const TYPES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

export function sniffImage(bytes: Buffer): { mime: string; ext: string } | null {
  const t = TYPES.find((x) => x.test(bytes));
  return t ? { mime: t.mime, ext: t.ext } : null;
}

export function imageChallengeSignature(bytes: Buffer, key: string): string {
  const hash = crypto.createHash("sha256").update("ImageSigningChallenge").update(bytes).digest();
  return PrivateKey.fromString(key).sign(hash).toString();
}

export async function uploadImage(
  bytes: Buffer,
  signer: ImageSigner,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20000
): Promise<{ ok: true; url: string } | { ok: false; status: number; code: string }> {
  if (bytes.length === 0 || bytes.length > LIMITS.imageBytesMax) return { ok: false, status: 413, code: "image_too_large" };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, status: 415, code: "unsupported_image" };
  const signature = imageChallengeSignature(bytes, signer.key);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: type.mime }), `image.${type.ext}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://images.hive.blog/${signer.author}/${signature}`, {
      method: "POST",
      body: form,
      redirect: "manual",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: 502, code: "image_host_rejected" };
    const json = (await res.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof json.url === "string" ? json.url : "";
    if (!/^https:\/\/images\.hive\.blog\/[^\s"<>]{1,2000}$/.test(url)) return { ok: false, status: 502, code: "image_host_bad_response" };
    return { ok: true, url };
  } catch {
    return { ok: false, status: 502, code: "image_upload_failed" };
  } finally {
    clearTimeout(timer);
  }
}
