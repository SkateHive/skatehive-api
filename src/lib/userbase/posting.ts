import { PrivateKey } from "@hiveio/dhive";
import { HiveClient } from "@/app/utils/hive/hiveUtils";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { decryptSecret, decryptHivePostingKey } from "./encryption";
import { getSafeUserIdentifier } from "./safeUser";

// Resolve who signs for a userbase user: their own stored Hive key if they have
// one, otherwise the shared @skateuser account (lite accounts). Mirrors the web
// app's comment/vote getPostingKey + default-account logic.
export interface Signer { author: string; key: string; usingDefault: boolean }

export async function resolveSigner(userId: string): Promise<Signer> {
  if (!supabaseAdmin) throw new Error("Userbase backend not configured");
  const { data } = await supabaseAdmin
    .from("userbase_hive_keys")
    .select("encrypted_posting_key, encryption_iv, encryption_auth_tag, hive_username")
    .eq("user_id", userId)
    .limit(1);
  const row = data?.[0];
  if (row?.encrypted_posting_key && row.hive_username) {
    let key: string;
    try {
      key = decryptHivePostingKey(
        { encryptedKey: row.encrypted_posting_key, iv: row.encryption_iv, authTag: row.encryption_auth_tag },
        userId
      );
    } catch {
      key = decryptSecret(
        JSON.stringify({ iv: row.encryption_iv, tag: row.encryption_auth_tag, data: row.encrypted_posting_key })
      );
    }
    return { author: row.hive_username, key, usingDefault: false };
  }
  const author = process.env.DEFAULT_HIVE_POSTING_ACCOUNT;
  const key = process.env.DEFAULT_HIVE_POSTING_KEY;
  if (!author || !key) throw new Error("Shared posting account not configured");
  return { author, key, usingDefault: true };
}

export async function broadcastVote(
  signer: Signer,
  author: string,
  permlink: string,
  weight: number
): Promise<void> {
  await HiveClient.broadcast.vote(
    { voter: signer.author, author, permlink, weight },
    PrivateKey.fromString(signer.key)
  );
}

export async function broadcastComment(
  signer: Signer,
  opts: {
    parentAuthor: string;
    parentPermlink: string;
    permlink: string;
    title: string;
    body: string;
    jsonMetadata: Record<string, unknown>;
  }
): Promise<void> {
  await HiveClient.broadcast.comment(
    {
      parent_author: opts.parentAuthor,
      parent_permlink: opts.parentPermlink,
      author: signer.author,
      permlink: opts.permlink,
      title: opts.title,
      body: opts.body,
      json_metadata: JSON.stringify(opts.jsonMetadata),
    },
    PrivateKey.fromString(signer.key)
  );
}

// Generic custom_json broadcast signed with posting authority (follow, mute,
// notify, reports, etc.). The op is always authorised as the signer's own
// account.
export async function broadcastCustomJson(
  signer: Signer,
  id: string,
  json: string
): Promise<void> {
  await HiveClient.broadcast.json(
    {
      required_auths: [],
      required_posting_auths: [signer.author],
      id,
      json,
    },
    PrivateKey.fromString(signer.key)
  );
}

// account_update2 — only posting_json_metadata is changed (posting authority is
// sufficient; we never touch keys/owner). json_metadata is left empty to mirror
// the mobile client's updateProfile().
export async function broadcastAccountUpdate(
  signer: Signer,
  postingJsonMetadata: string
): Promise<void> {
  await HiveClient.broadcast.sendOperations(
    [
      [
        "account_update2",
        {
          account: signer.author,
          json_metadata: "",
          posting_json_metadata: postingJsonMetadata,
          extensions: [],
        },
      ],
    ],
    PrivateKey.fromString(signer.key)
  );
}

// Attribution records (only when posting via the shared account).
export async function recordSoftPost(
  userId: string,
  opts: { author: string; permlink: string; title: string; type: string; metadata: Record<string, unknown> }
): Promise<void> {
  if (!supabaseAdmin) return;
  const now = new Date().toISOString();
  await supabaseAdmin.from("userbase_soft_posts").insert({
    user_id: userId,
    author: opts.author,
    permlink: opts.permlink,
    title: opts.title,
    type: opts.type,
    status: "broadcasted",
    safe_user: getSafeUserIdentifier(userId),
    metadata: opts.metadata,
    created_at: now,
    updated_at: now,
    broadcasted_at: now,
  });
}

export async function recordSoftVote(
  userId: string,
  opts: { author: string; permlink: string; weight: number; metadata: Record<string, unknown> }
): Promise<void> {
  if (!supabaseAdmin) return;
  const now = new Date().toISOString();
  await supabaseAdmin.from("userbase_soft_votes").upsert(
    {
      user_id: userId,
      author: opts.author,
      permlink: opts.permlink,
      weight: opts.weight,
      status: "broadcasted",
      metadata: opts.metadata,
      created_at: now,
      updated_at: now,
      broadcasted_at: now,
    },
    { onConflict: "user_id,author,permlink" }
  );
}
