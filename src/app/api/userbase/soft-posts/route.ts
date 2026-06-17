import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

export const runtime = "nodejs";

// Batch overlay lookup: given a set of on-chain posts (the shared @skateuser
// account), return the REAL author behind each one so the client can mask the
// shared account with the real user's profile. Mirrors the web app's
// /api/userbase/soft-posts. Public (no auth) — it only exposes public profile
// fields for posts that were already broadcast publicly.
export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Userbase backend not configured" },
      { status: 500 }
    );
  }
  const body = await req.json().catch(() => null);
  const posts = Array.isArray(body?.posts) ? body.posts : [];
  const permlinks = posts
    .map((p: { permlink?: unknown }) => (typeof p?.permlink === "string" ? p.permlink : null))
    .filter((p: string | null): p is string => !!p)
    .slice(0, 200); // cap batch size

  if (permlinks.length === 0) {
    return NextResponse.json({ success: true, results: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("userbase_soft_posts")
    .select("author, permlink, userbase_users(id, handle, display_name, avatar_url)")
    .in("permlink", permlinks);

  if (error) {
    console.error("[userbase/soft-posts] query failed", error);
    return NextResponse.json({ success: false, error: "Lookup failed" }, { status: 500 });
  }

  const results = (data ?? []).map((r: any) => ({
    author: r.author,
    permlink: r.permlink,
    user: r.userbase_users
      ? {
          id: r.userbase_users.id,
          handle: r.userbase_users.handle,
          display_name: r.userbase_users.display_name,
          avatar_url: r.userbase_users.avatar_url,
        }
      : null,
  }));

  return NextResponse.json(
    { success: true, results },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" } }
  );
}
