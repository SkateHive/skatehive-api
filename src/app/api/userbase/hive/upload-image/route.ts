import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { PrivateKey } from "@hiveio/dhive";
import { resolveUserbaseUserId } from "@/lib/userbase/session";
import { resolveSigner } from "@/lib/userbase/posting";

export const runtime = "nodejs";

// Server-side image upload for email/lite accounts (no posting key on device).
// The client sends the (already converted) image bytes; the server signs the
// Hive image-upload challenge with the user's key — or the shared @skateuser
// account — and uploads to images.hive.blog, returning the public URL.
export async function POST(req: NextRequest) {
  const userId = await resolveUserbaseUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let bytes: Buffer;
  let contentType = "image/jpeg";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ success: false, error: "No image file" }, { status: 400 });
    }
    if (file.type) contentType = file.type;
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ success: false, error: "Invalid upload" }, { status: 400 });
  }
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
    return NextResponse.json({ success: false, error: "Image missing or too large" }, { status: 400 });
  }

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/upload-image] signer", e);
    return NextResponse.json({ success: false, error: "Upload not available" }, { status: 500 });
  }

  // Hive image-signing challenge: sign sha256("ImageSigningChallenge" + bytes).
  const hash = crypto.createHash("sha256");
  hash.update("ImageSigningChallenge");
  hash.update(bytes);
  const signature = PrivateKey.fromString(signer.key).sign(hash.digest()).toString();

  try {
    const up = new FormData();
    up.append("file", new Blob([bytes], { type: contentType }), "image.jpg");
    const res = await fetch(`https://images.hive.blog/${signer.author}/${signature}`, {
      method: "POST",
      body: up,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[userbase/upload-image] hive images failed", res.status, text);
      return NextResponse.json({ success: false, error: "Image host rejected upload" }, { status: 502 });
    }
    const json = (await res.json()) as { url?: string };
    if (!json.url) {
      return NextResponse.json({ success: false, error: "No URL returned" }, { status: 502 });
    }
    return NextResponse.json({ success: true, url: json.url });
  } catch (e) {
    console.error("[userbase/upload-image] upload", e);
    return NextResponse.json({ success: false, error: "Upload failed" }, { status: 502 });
  }
}
