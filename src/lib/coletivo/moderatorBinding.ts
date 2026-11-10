import crypto from "crypto";
import { Signature, cryptoUtils } from "@hiveio/dhive";
import { MODERATOR_HIVE_HANDLES } from "./config";

// Moderator binding: a coletivoxv app-session user proves control of an
// allow-listed Hive account by signing a fresh, single-use, server-stored
// challenge with that account's posting key (Hive Keychain requestSignBuffer).
// userbase_identities.verified_at is NOT used as proof (the web bootstrap
// route can set it without any signature).

export function isAllowedModeratorHandle(handle: string): boolean {
  return MODERATOR_HIVE_HANDLES.includes(handle);
}

export function newNonce(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** The exact text the moderator signs. Every binding field is in it. */
export function buildChallengeMessage(c: {
  app: string;
  userId: string;
  hiveHandle: string;
  nonce: string;
  expiresAt: string;
}): string {
  return [
    `${c.app}: moderator access`,
    `Hive account: @${c.hiveHandle}`,
    `User: ${c.userId}`,
    `Nonce: ${c.nonce}`,
    `Expires: ${c.expiresAt}`,
  ].join("\n");
}

function parseSignature(raw: string): Signature | null {
  let hex = (raw || "").trim().toLowerCase();
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (!/^[0-9a-f]{130}$/.test(hex)) return null; // 65 bytes, recoverable
  try {
    return Signature.fromBuffer(Buffer.from(hex, "hex"));
  } catch {
    return null;
  }
}

export type HiveAccountAuth = {
  posting?: { weight_threshold?: number; key_auths?: Array<[string, number]> };
};

export type BindingVerdict =
  | { ok: true; publicKey: string }
  | { ok: false; status: number; code: string };

/**
 * Recover the signer from (message, signature) and require that key to carry
 * enough posting weight on-chain for `hiveHandle` on its own.
 */
export async function verifyBindingSignature(args: {
  message: string;
  signature: string;
  hiveHandle: string;
  getAccount: (handle: string) => Promise<HiveAccountAuth | null>;
}): Promise<BindingVerdict> {
  const sig = parseSignature(args.signature);
  if (!sig) return { ok: false, status: 400, code: "invalid_signature" };
  let publicKey: string;
  try {
    const digest = cryptoUtils.sha256(Buffer.from(args.message, "utf8"));
    publicKey = sig.recover(digest).toString();
  } catch {
    return { ok: false, status: 400, code: "invalid_signature" };
  }

  let account: HiveAccountAuth | null;
  try {
    account = await args.getAccount(args.hiveHandle);
  } catch {
    return { ok: false, status: 503, code: "chain_unavailable" };
  }
  if (!account) return { ok: false, status: 403, code: "key_not_authorized" };

  const threshold = Number(account.posting?.weight_threshold ?? 1);
  const weight = (account.posting?.key_auths || [])
    .filter(([key]) => String(key) === publicKey)
    .reduce((sum, [, w]) => sum + Number(w), 0);
  if (weight < threshold || weight <= 0) return { ok: false, status: 403, code: "key_not_authorized" };
  return { ok: true, publicKey };
}
