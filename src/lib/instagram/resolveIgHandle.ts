import { HiveClient } from "@/app/utils/hive/hiveUtils";

/**
 * Resolve an Instagram handle for caption @-mentions. Ported from
 * skatehive3.0/lib/instagram/resolveIgHandle.ts (HiveClient import adjusted for
 * this service). Priority: userbase_identities(type='instagram') for the user,
 * then the Hive profile.instagram fallback. Returns the bare handle or null.
 */
export async function resolveIgHandleForCaption(args: {
  hiveAuthor: string;
  userId: string | null;
  supabase: any;
}): Promise<string | null> {
  const { hiveAuthor, userId, supabase } = args;

  if (userId && supabase) {
    const { data } = await supabase
      .from("userbase_identities")
      .select("handle")
      .eq("user_id", userId)
      .eq("type", "instagram")
      .limit(1);
    const handle = data?.[0]?.handle;
    if (handle && typeof handle === "string") return sanitize(handle);
  }

  const fromHive = await readIgFromHiveProfile(hiveAuthor);
  if (fromHive) return sanitize(fromHive);

  return null;
}

async function readIgFromHiveProfile(hiveAuthor: string): Promise<string | null> {
  try {
    const accounts = await HiveClient.database.getAccounts([hiveAuthor]);
    const acc = accounts?.[0];
    if (!acc) return null;
    const meta = parseJson(acc.posting_json_metadata) ?? parseJson(acc.json_metadata);
    const profile = meta?.profile;
    if (!profile || typeof profile !== "object") return null;

    if (typeof profile.instagram === "string" && profile.instagram.trim()) {
      return profile.instagram.trim();
    }
    if (
      profile.social &&
      typeof profile.social === "object" &&
      typeof profile.social.instagram === "string" &&
      profile.social.instagram.trim()
    ) {
      return profile.social.instagram.trim();
    }
    if (typeof profile.website === "string") {
      const m = profile.website.match(/instagram\.com\/([A-Za-z0-9._]+)/);
      if (m) return m[1];
    }
  } catch {
    // RPC unavailable — return null.
  }
  return null;
}

function parseJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Strip leading @, lowercase, drop illegal chars. Null if empty or >30 chars. */
export function sanitize(raw: string): string | null {
  const cleaned = raw.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, "");
  if (!cleaned || cleaned.length > 30) return null;
  return cleaned;
}
