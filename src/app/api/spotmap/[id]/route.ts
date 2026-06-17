import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// Single spot by uuid — used by the mobile detail screen (fetchSpotById).
// The skatehive3.0 web app never shipped this route, so detail-by-id used to
// 404; serving it here fixes that while also moving the read off the gated
// website origin. Selects all columns so the detail screen gets images /
// kml_description.
export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Spot map backend not configured" },
      { status: 500 }
    );
  }

  // Last non-empty path segment, e.g. /api/spotmap/<uuid>.
  const id = decodeURIComponent(
    new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""
  );
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing spot id" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("spotmap_spots")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/spotmap/[id]] query failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load spot" },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Spot not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { success: true, spot: data },
    {
      headers: {
        "Cache-Control":
          "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
