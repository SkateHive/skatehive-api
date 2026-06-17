import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Public read endpoint for the synced skate-spot map. Mirrored from the
// skatehive3.0 web app onto api.skatehive.app so the mobile app no longer
// depends on the website's Vercel firewall posture (Attack Challenge Mode on
// skatehive.app was serving a JS challenge to the app's fetch). One query, no
// pagination — the map wants everything at once. Same Supabase project as the
// userbase tables (see supabaseAdmin), which is where spotmap_spots lives.
export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Spot map backend not configured" },
      { status: 500 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("spotmap_spots")
    .select(
      "id, source, source_id, name, lat, lng, address, thumbnail, " +
        "hive_author, hive_permlink, hive_created, kml_description"
    )
    .order("hive_created", { ascending: false, nullsFirst: false })
    .limit(10000);

  if (error) {
    console.error("[GET /api/spotmap] query failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load spots" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, count: data?.length ?? 0, spots: data ?? [] },
    {
      headers: {
        // Edge-cache — sync is manual so freshness pressure is low.
        "Cache-Control":
          "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
