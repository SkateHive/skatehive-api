import crypto from "crypto";
import { authenticateAppClient } from "@/lib/userbase/appClient";

// WhatsApp bot (OpenClaw on the Skatehive Mac mini) as a partner app client.
// See skatehive3.0 sql/migrations/0044_userbase_whatsapp.sql for the trust
// model. Pure helpers here; routes do the I/O.
//
// Env:
//   USERBASE_APP_CLIENTS   must include  whatsapp:<sha256 of the bot secret>
//   WHATSAPP_PHONE_PEPPER  32+ random bytes (hex). Never change after launch:
//                          every stored link is keyed by it.

export const WHATSAPP_APP_ID = "whatsapp";
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const SNAPS_PER_DAY = 5;
export const SNAP_MAX_CHARS = 1000;

// No 0/O/1/I/L: people read the code on one screen and type it on another.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 8;

/** Only the bot server (app id "whatsapp" + its secret) may call bot routes. */
export function isWhatsappBot(headers: Headers, rawConfig?: string): boolean {
  const app = authenticateAppClient(headers, rawConfig);
  return app.kind === "app" && app.appId === WHATSAPP_APP_ID;
}

/**
 * Digits of a WhatsApp sender: accepts "+55 21 9...", "5521...", or a JID
 * like "5521...@s.whatsapp.net" / "5521...:12@s.whatsapp.net" (device suffix).
 * Returns null for anything that is not 8–15 digits (E.164 max is 15).
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const user = raw.trim().split("@")[0].split(":")[0];
  if (!/^\+?[\d\s().-]+$/.test(user)) return null;
  const digits = user.replace(/\D/g, "");
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
  const s = raw.toUpperCase().replace(/[\s_]/g, "").replace(/^SK-?/, "");
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

export function snapPermlink(now = Date.now()): string {
  return `wa-${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function snapMetadata(safeUser: string | null): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    app: "skatehive-whatsapp",
    tags: ["snaps", "hive-173115", "skatehive", "skate"],
  };
  if (safeUser) meta.skatehive_user = safeUser;
  return meta;
}

/** Start of the current UTC day (daily snap cap window). */
export function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
