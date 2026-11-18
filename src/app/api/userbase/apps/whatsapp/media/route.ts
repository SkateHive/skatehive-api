import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { isWhatsappBot, MEDIA_IMAGE_MAX_BYTES, sniffImage } from "@/lib/whatsapp/core";
import { botGate, fail, linkedUserId } from "@/lib/whatsapp/routeKit";

export const runtime = "nodejs";

const PINATA_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const GATEWAY = "https://ipfs.skatehive.app/ipfs/";

// Bot only. multipart/form-data { sender, file }: a photo someone sent the bot
// while making a snap. Only linked numbers may upload (same as posting), the
// type is read from the bytes, and the file is pinned to our IPFS. Returns the
// gateway URL the bot then passes to POST .../whatsapp/snap as media.
// Videos do not come here (Vercel body cap): the bot sends them straight to
// the transcoder, like the mobile app does.
export async function POST(req: NextRequest) {
  if (!isWhatsappBot(req.headers)) return fail(401, "unauthorized");
  if (!supabaseAdmin) return fail(503, "unavailable");
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return fail(503, "unavailable");

  const form = await req.formData().catch(() => null);
  if (!form) return fail(422, "invalid_form");
  const call = botGate(null, form.get("sender"), "media", 10, 10 * 60_000);
  if (!call.ok) return call.res;

  const file = form.get("file");
  if (!(file instanceof Blob)) return fail(422, "no_file");
  if (file.size === 0 || file.size > MEDIA_IMAGE_MAX_BYTES) return fail(413, "too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return fail(415, "unsupported_type");

  let userId: string | null;
  try {
    userId = await linkedUserId(call.phoneHash);
  } catch {
    return fail(503, "unavailable");
  }
  if (!userId) return fail(403, "not_linked");

  const name = `whatsapp-${Date.now().toString(36)}.${kind.ext}`;
  const upload = new FormData();
  upload.append("file", new Blob([bytes], { type: kind.mime }), name);
  upload.append(
    "pinataMetadata",
    JSON.stringify({ name, keyvalues: { source: "skatehive-whatsapp", fileType: "image" } })
  );
  upload.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  try {
    const res = await fetch(PINATA_URL, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: upload });
    if (!res.ok) {
      console.error("[whatsapp/media] pinata", res.status, (await res.text()).slice(0, 200));
      return fail(502, "upload_failed");
    }
    const { IpfsHash } = await res.json();
    if (typeof IpfsHash !== "string" || !/^[A-Za-z0-9]{40,100}$/.test(IpfsHash)) return fail(502, "upload_failed");
    return NextResponse.json({ success: true, type: "image", url: `${GATEWAY}${IpfsHash}` });
  } catch (e) {
    console.error("[whatsapp/media] upload", e);
    return fail(502, "upload_failed");
  }
}
