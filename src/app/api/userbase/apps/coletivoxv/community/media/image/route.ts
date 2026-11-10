import { NextRequest } from "next/server";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { LIMITS } from "@/lib/coletivo/config";
import { uploadImage } from "@/lib/coletivo/imageUpload";
import { me } from "@/lib/coletivo/store";
import { resolveSigner } from "@/lib/userbase/posting";
import { isRateLimited, recordAttempt } from "@/lib/userbase/rateLimit";

export const runtime = "nodejs";

const HOUR = 60 * 60 * 1000;

// Photo upload (<= 4MB). The result is PUBLIC on images.hive.blog as soon as it
// is uploaded, whatever happens to the submission afterwards.
export async function POST(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const rlKey = `coletivo-img:${s.tokenHash}`;
  if (isRateLimited(rlKey, 30, HOUR)) return err(429, "rate_limited");

  let userId: string;
  try {
    userId = (await me(s.tokenHash)).user_id;
  } catch (e) {
    return storeErrorResponse(e);
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > LIMITS.imageBytesMax + 64 * 1024) return err(413, "image_too_large");
  let bytes: Buffer;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return err(400, "no_file");
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return err(400, "invalid_upload");
  }
  recordAttempt(rlKey, HOUR);

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch {
    return err(503, "upload_unavailable");
  }
  const r = await uploadImage(bytes, signer);
  if (!r.ok) return err(r.status, r.code);
  return json(200, { success: true, media: { type: "image", url: r.url } });
}
