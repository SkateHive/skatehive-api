import { PublicKey, Signature, cryptoUtils } from "@hiveio/dhive";
import { HiveClient } from "@/app/utils/hive/hiveUtils";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Per-request posting-key signature auth for the mobile Instagram flow on
// api.skatehive.app. The client signs an explicit message with its Hive posting
// key; we verify the signature + that the key is authorized on-chain for the
// claimed author. Stateless — no cookie/session/bootstrap needed.

export const MAX_SIG_AGE_MS = 5 * 60 * 1000; // replay window

/** Cross-post message — MUST match the mobile client byte-for-byte. */
export function buildIgAuthMessage(args: {
  hiveAuthor: string;
  hivePermlink: string;
  issuedAt: string;
}) {
  return [
    "Skatehive: cross-post snap to @skatehive on Instagram.",
    `Author: @${args.hiveAuthor}`,
    `Permlink: ${args.hivePermlink}`,
    `Issued at: ${args.issuedAt}`,
  ].join("\n");
}

/** IG-handle management message — MUST match the mobile client byte-for-byte. */
export function buildIgHandleAuthMessage(args: { hiveAuthor: string; issuedAt: string }) {
  return [
    "Skatehive: manage Instagram handle for @skatehive cross-posting.",
    `Author: @${args.hiveAuthor}`,
    `Issued at: ${args.issuedAt}`,
  ].join("\n");
}

function parseSignature(signature: string) {
  let n = signature.trim().toLowerCase();
  if (n.startsWith("0x")) n = n.slice(2);
  if (!/^[0-9a-f]+$/.test(n)) return null;
  const buf = Buffer.from(n, "hex");
  if (buf.length === 65) return Signature.fromBuffer(buf);
  if (buf.length === 64) return new Signature(buf, 0);
  return null;
}

/**
 * Verify a posting-key signature over `message`, the 5-min replay window, and
 * that `hivePublicKey` is in the on-chain posting key_auths of `hiveAuthor`.
 */
export async function verifyHiveSignature(args: {
  message: string;
  hiveAuthor: string;
  hivePublicKey: string;
  hiveSignature: string;
  issuedAt: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const issuedTs = Date.parse(args.issuedAt);
  if (!Number.isFinite(issuedTs)) return { ok: false, status: 400, error: "Invalid issued_at." };
  if (Math.abs(Date.now() - issuedTs) > MAX_SIG_AGE_MS) {
    return { ok: false, status: 401, error: "Signature too old; re-sign and retry." };
  }

  const sig = parseSignature(args.hiveSignature);
  if (!sig) return { ok: false, status: 400, error: "Invalid signature format." };
  try {
    const digest = cryptoUtils.sha256(Buffer.from(args.message));
    const pub = PublicKey.fromString(args.hivePublicKey);
    if (!pub.verify(digest, sig)) {
      return { ok: false, status: 401, error: "Signature does not match message." };
    }
  } catch {
    return { ok: false, status: 400, error: "Failed to verify signature." };
  }

  let account: any;
  try {
    const accounts = await HiveClient.database.getAccounts([args.hiveAuthor]);
    account = accounts?.[0];
  } catch {
    return { ok: false, status: 404, error: "Hive account not found." };
  }
  if (!account) return { ok: false, status: 404, error: "Hive account not found." };
  const postingKeys: string[] = (account.posting?.key_auths || []).map((e: any) => String(e[0]));
  if (!postingKeys.includes(args.hivePublicKey)) {
    return { ok: false, status: 403, error: "Public key is not authorized to post for this Hive account." };
  }
  return { ok: true };
}

/**
 * Find or create the userbase user for a verified Hive author, returning its
 * user_id (used for per-user dedupe/limits and to store the IG handle in
 * userbase). Call ONLY after verifyHiveSignature passes. The hive identity is
 * the authoritative key; userbase_users.handle is cosmetic (falls back to null
 * if a lite account already reserved that handle).
 */
export async function getOrCreateHiveUserId(hiveAuthor: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const handle = hiveAuthor.trim().toLowerCase();

  const findHiveUser = async (): Promise<string | null> => {
    const { data } = await supabaseAdmin!
      .from("userbase_identities")
      .select("user_id")
      .eq("type", "hive")
      .eq("handle", handle)
      .limit(1);
    return (data?.[0]?.user_id as string) || null;
  };

  const existing = await findHiveUser();
  if (existing) return existing;

  let userId: string | null = null;
  for (const h of [handle, null]) {
    const { data, error } = await supabaseAdmin
      .from("userbase_users")
      .insert({
        handle: h,
        display_name: handle,
        avatar_url: `https://images.hive.blog/u/${handle}/avatar`,
        status: "active",
        onboarding_step: 0,
      })
      .select("id")
      .single();
    if (!error && data) {
      userId = data.id as string;
      break;
    }
  }
  if (!userId) return await findHiveUser();

  const { error: idErr } = await supabaseAdmin.from("userbase_identities").insert({
    user_id: userId,
    type: "hive",
    handle,
    address: null,
    external_id: null,
    is_primary: true,
    verified_at: new Date().toISOString(),
    metadata: {},
  });
  if (idErr) {
    // Hive identity already exists (race) — use the winner.
    const winner = await findHiveUser();
    return winner || userId;
  }
  return userId;
}
