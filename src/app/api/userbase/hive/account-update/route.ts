import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId } from "@/lib/userbase/session";
import { resolveSigner, broadcastAccountUpdate } from "@/lib/userbase/posting";
import { HiveClient } from "@/app/utils/hive/hiveUtils";

export const runtime = "nodejs";

// Update profile (posting_json_metadata) on behalf of a userbase user. The
// server signs account_update2 with their stored key. Refused for lite accounts
// since editing the shared @skateuser profile would be catastrophic.
//
// The incoming `profile` is treated as a PATCH: we merge it over the account's
// current on-chain profile (read here, keyed by the resolved signer — the only
// place that authoritatively knows which Hive account we sign as). This keeps
// unedited fields intact even when the client's merge-base was wrong/empty
// (e.g. a userbase handle that differs from the on-chain account).
export async function POST(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const profile = body?.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return NextResponse.json(
      { success: false, error: "profile object is required" },
      { status: 400 }
    );
  }

  let signer;
  try {
    signer = await resolveSigner(userId);
  } catch (e) {
    console.error("[userbase/hive/account-update] signer", e);
    return NextResponse.json({ success: false, error: "Posting not available" }, { status: 500 });
  }

  if (signer.usingDefault) {
    return NextResponse.json(
      {
        success: false,
        error: "This action requires your own Hive account",
        code: "REQUIRES_OWN_HIVE_ACCOUNT",
      },
      { status: 403 }
    );
  }

  // Merge the incoming fields over the account's current on-chain profile so
  // fields the client didn't send (e.g. cover_image) aren't wiped.
  let existingMeta: Record<string, unknown> = {};
  try {
    const [acct] = await HiveClient.database.getAccounts([signer.author]);
    existingMeta = JSON.parse(acct?.posting_json_metadata || "{}");
  } catch {
    existingMeta = {};
  }
  const existingProfile =
    (existingMeta.profile && typeof existingMeta.profile === "object"
      ? (existingMeta.profile as Record<string, unknown>)
      : {});
  const mergedMeta = {
    ...existingMeta,
    profile: { ...existingProfile, ...(profile as Record<string, unknown>) },
  };
  const postingJsonMetadata = JSON.stringify(mergedMeta);

  try {
    await broadcastAccountUpdate(signer, postingJsonMetadata);
  } catch (e) {
    console.error("[userbase/hive/account-update] broadcast", e);
    return NextResponse.json(
      { success: false, error: "Profile update failed to broadcast" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, author: signer.author });
}
