import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { resolveIgHandleForCaption, sanitize } from "@/lib/instagram/resolveIgHandle";
import {
  buildIgHandleAuthMessage,
  verifyHiveSignature,
  getOrCreateHiveUserId,
} from "@/lib/instagram/signatureAuth";
import { resolveUserbaseUserId, getPrimaryHiveHandle } from "@/lib/userbase/session";

export const runtime = "nodejs";

// Manage a user's Instagram handle (userbase_identities type='instagram').
// Auth: signature over buildIgHandleAuthMessage (mobile key accounts) OR a
// userbase session — Bearer token (mobile email accounts) / userbase_refresh
// cookie (web). Returns { handle, source } so the first-time prompt fires when
// source === null.

interface SigParams {
  hiveAuthor: string;
  hivePublicKey: string;
  hiveSignature: string;
  issuedAt: string;
}

async function authUser(
  req: NextRequest,
  params: SigParams
): Promise<
  | { ok: true; userId: string; hiveAuthor: string | null }
  | { ok: false; status: number; error: string }
> {
  // Signature path (key accounts).
  if (params.hiveAuthor && params.hivePublicKey && params.hiveSignature && params.issuedAt) {
    const verified = await verifyHiveSignature({
      message: buildIgHandleAuthMessage({ hiveAuthor: params.hiveAuthor, issuedAt: params.issuedAt }),
      hiveAuthor: params.hiveAuthor,
      hivePublicKey: params.hivePublicKey,
      hiveSignature: params.hiveSignature,
      issuedAt: params.issuedAt,
    });
    if (!verified.ok) return verified;
    const userId = await getOrCreateHiveUserId(params.hiveAuthor);
    if (!userId) return { ok: false, status: 500, error: "Could not resolve user." };
    return { ok: true, userId, hiveAuthor: params.hiveAuthor };
  }
  // Session path (email Bearer / web cookie).
  const userId = await resolveUserbaseUserId(req);
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };
  const hiveAuthor = await getPrimaryHiveHandle(userId);
  return { ok: true, userId, hiveAuthor };
}

function fromQuery(req: NextRequest): SigParams {
  const q = new URL(req.url).searchParams;
  return {
    hiveAuthor: (q.get("hive_author") || "").trim().toLowerCase(),
    hivePublicKey: q.get("hive_public_key") || "",
    hiveSignature: q.get("hive_signature") || "",
    issuedAt: q.get("signed_at") || "",
  };
}

function fromBody(body: any): SigParams {
  return {
    hiveAuthor: typeof body?.hive_author === "string" ? body.hive_author.trim().toLowerCase() : "",
    hivePublicKey: typeof body?.hive_public_key === "string" ? body.hive_public_key : "",
    hiveSignature: typeof body?.hive_signature === "string" ? body.hive_signature : "",
    issuedAt: typeof body?.signed_at === "string" ? body.signed_at : "",
  };
}

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Missing config" }, { status: 500 });
  const auth = await authUser(req, fromQuery(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data } = await supabaseAdmin
    .from("userbase_identities")
    .select("handle")
    .eq("user_id", auth.userId)
    .eq("type", "instagram")
    .limit(1);
  const dbHandle = data?.[0]?.handle;
  if (dbHandle) return NextResponse.json({ handle: dbHandle, source: "db" });

  // Fall back to the Hive profile so an existing on-chain handle isn't re-prompted.
  const resolved = auth.hiveAuthor
    ? await resolveIgHandleForCaption({
        hiveAuthor: auth.hiveAuthor,
        userId: auth.userId,
        supabase: supabaseAdmin,
      })
    : null;
  return NextResponse.json({ handle: resolved, source: resolved ? "hive" : null });
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Missing config" }, { status: 500 });
  const body = await req.json().catch(() => null);
  const auth = await authUser(req, fromBody(body));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const handle = sanitize(typeof body?.handle === "string" ? body.handle : "");
  if (!handle) {
    return NextResponse.json(
      { error: "Invalid Instagram handle. Use 1-30 letters, numbers, '.', or '_'." },
      { status: 400 }
    );
  }

  // Reject handles already claimed by a different user (the unique index also guards this).
  const { data: claimed } = await supabaseAdmin
    .from("userbase_identities")
    .select("user_id")
    .eq("type", "instagram")
    .ilike("handle", handle)
    .neq("user_id", auth.userId)
    .limit(1);
  if (claimed && claimed.length > 0) {
    return NextResponse.json(
      { error: `@${handle} is already claimed by another SkateHive user.` },
      { status: 409 }
    );
  }

  // Upsert via delete-then-insert (userbase_identities has multiple unique indices).
  await supabaseAdmin
    .from("userbase_identities")
    .delete()
    .eq("user_id", auth.userId)
    .eq("type", "instagram");
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("userbase_identities")
    .insert({
      user_id: auth.userId,
      type: "instagram",
      handle,
      is_primary: true,
      metadata: { source: "crosspost_prompt", claimed_at: new Date().toISOString() },
    })
    .select("handle")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json({ error: insertErr?.message || "Failed to save Instagram handle." }, { status: 500 });
  }
  return NextResponse.json({ handle: inserted.handle });
}

export async function DELETE(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Missing config" }, { status: 500 });
  const body = await req.json().catch(() => null);
  const auth = await authUser(req, fromBody(body));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await supabaseAdmin
    .from("userbase_identities")
    .delete()
    .eq("user_id", auth.userId)
    .eq("type", "instagram");
  return NextResponse.json({ ok: true });
}
