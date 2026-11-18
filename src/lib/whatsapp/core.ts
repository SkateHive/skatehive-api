import crypto from "crypto";
import { authenticateAppClient } from "@/lib/userbase/appClient";

// WhatsApp bot (OpenClaw on the Skatehive Mac mini) as a partner app client.
// See skatehive3.0 sql/migrations/0044_userbase_whatsapp.sql for the trust
// model. Pure helpers here; routes do the I/O.
//
// Env:
//   WHATSAPP_APP_SECRET_SHA256  sha256 hex of the bot secret (the raw secret
//                          lives only on the bot server). Kept apart from
//                          USERBASE_APP_CLIENTS, which is a write-only
//                          "sensitive" var shared with other partner apps;
//                          a whatsapp entry there is still honoured.
//   WHATSAPP_PHONE_PEPPER  32+ random bytes (hex). Never change after launch:
//                          every stored link is keyed by it.

export const WHATSAPP_APP_ID = "whatsapp";
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const SNAPS_PER_DAY = 5;
export const SNAP_MAX_CHARS = 1000;

// No 0/O/1/I/L: people read the code on one screen and type it on another.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 8;

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Only the bot server (app id "whatsapp" + its secret) may call bot routes.
 * The bot's hash comes from WHATSAPP_APP_SECRET_SHA256 when set, otherwise
 * from a whatsapp entry in USERBASE_APP_CLIENTS. Other apps never pass.
 */
export function isWhatsappBot(
  headers: Headers,
  rawConfig: string | undefined = process.env.USERBASE_APP_CLIENTS,
  ownHash: string | undefined = process.env.WHATSAPP_APP_SECRET_SHA256
): boolean {
  const hash = (ownHash || "").trim().toLowerCase();
  const config = HASH_RE.test(hash) ? `${WHATSAPP_APP_ID}:${hash}` : rawConfig;
  const app = authenticateAppClient(headers, config);
  return app.kind === "app" && app.appId === WHATSAPP_APP_ID;
}

// Only phone-number JIDs identify a phone. @lid (privacy ids), @g.us (groups),
// @broadcast, @newsletter, etc. are NOT phone numbers even when they look like
// digits, so they must never map onto a phone identity.
const PHONE_JID_RE = /^(\d{8,15})(?::\d{1,3})?@(?:s\.whatsapp\.net|c\.us)$/;

/**
 * Digits of a WhatsApp sender: accepts "+55 21 9...", "5521...", or a phone
 * JID "5521...@s.whatsapp.net" / "5521...:12@s.whatsapp.net" (device suffix)
 * / legacy "...@c.us". Any other JID namespace is rejected.
 * Returns null for anything that is not 8–15 digits (E.164 max is 15).
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.includes("@")) {
    const m = PHONE_JID_RE.exec(s);
    return m ? m[1] : null;
  }
  if (!/^\+?[\d\s().-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function phoneHash(digits: string, pepper: string | undefined = process.env.WHATSAPP_PHONE_PEPPER): string {
  if (!pepper || pepper.length < 32) throw new Error("whatsapp_pepper_missing");
  return crypto.createHmac("sha256", pepper).update(digits).digest("hex");
}

export function generateLinkCode(): string {
  let out = "";
  const bytes = crypto.randomBytes(CODE_LEN);
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `SK-${out}`;
}

/** Canonical form of a code the person typed: upper case, no spaces, SK- prefix. */
export function normalizeLinkCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[\s_]/g, "");
  // Strip the optional prefix only when the input is longer than a bare code:
  // a code body may itself start with "SK" (e.g. SK-SKAB2345 typed as SKAB2345).
  if (s.length > CODE_LEN) s = s.replace(/^SK-?/, "");
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return `SK-${s}`;
}

export function codeHash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Snap text: trimmed, non-empty, capped. Returns null when unusable. */
export function cleanSnapBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  return s.length > SNAP_MAX_CHARS ? null : s;
}

// ---- Media (photos/videos sent on WhatsApp) -------------------------------
// The bot uploads first (photos through POST .../whatsapp/media, videos to the
// transcoder) and passes the resulting gateway URLs here. Only our own IPFS
// gateway is accepted, so a snap can never embed an arbitrary URL.
export const SNAP_MEDIA_MAX = 4;
export const MEDIA_IMAGE_MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB body cap
const IPFS_MEDIA_RE = /^https:\/\/ipfs\.skatehive\.app\/ipfs\/[A-Za-z0-9]{40,100}$/;

export type SnapMedia = { type: "image" | "video"; url: string };

/** Validated media list ([] when absent). null when anything is malformed. */
export function cleanSnapMedia(raw: unknown): SnapMedia[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > SNAP_MEDIA_MAX) return null;
  const out: SnapMedia[] = [];
  for (const item of raw) {
    const type = item?.type;
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if ((type !== "image" && type !== "video") || !IPFS_MEDIA_RE.test(url)) return null;
    out.push({ type, url });
  }
  return out;
}

/** Text plus the same media markup the mobile app writes (markdown image / video iframe). */
export function buildSnapBody(text: string, media: SnapMedia[]): string {
  const markup = media.map((m) =>
    m.type === "image"
      ? `![image](${m.url})`
      : `<iframe src="${m.url}" width="100%" height="400" frameborder="0" allowfullscreen title="Video"></iframe>`
  );
  return [text, ...markup].filter(Boolean).join("\n\n");
}

/** Image type from the file's first bytes (never trust the declared name/type). */
export function sniffImage(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === "GIF8") return { ext: "gif", mime: "image/gif" };
  return null;
}

export function snapPermlink(now = Date.now()): string {
  return `wa-${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function snapMetadata(safeUser: string | null, images: string[] = []): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    app: "skatehive-whatsapp",
    tags: ["snaps", "hive-173115", "skatehive", "skate"],
  };
  if (images.length > 0) meta.image = images;
  if (safeUser) meta.skatehive_user = safeUser;
  return meta;
}
