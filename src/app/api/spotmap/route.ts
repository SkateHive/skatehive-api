import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { resolveSmallThumbnail } from "@/lib/spotmap-thumbnails";
import { isMissingMediumColumn } from "@/lib/spotmap-medium";

// Cap how many rows one GET can kick off generation for. The backfill script
// is the primary way a large batch of missing thumbnails gets filled in —
// this is just enough to make a few new/edited spots show up without a
// separate backfill run, not a substitute for one.
const MAX_LAZY_GENERATIONS_PER_REQUEST = 5;
const HTTP_URL_RE = /^https?:\/\//i;

interface SpotRow {
  id: string;
  source: string;
  source_id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  thumbnail: string | null;
  thumbnail_override: string | null;
  thumbnail_small: string | null;
  // Not selected until the spotmap medium migration is applied (see below).
  thumbnail_medium?: string | null;
  hive_author: string | null;
  hive_permlink: string | null;
  hive_created: string | null;
  kml_description: string | null;
}

const BASE_COLUMNS =
  "id, source, source_id, name, lat, lng, address, thumbnail, " +
  "thumbnail_override, thumbnail_small, " +
  "hive_author, hive_permlink, hive_created, kml_description";

function selectSpots(withMedium: boolean) {
  return supabaseAdmin!
    .from("spotmap_spots")
    .select(withMedium ? `${BASE_COLUMNS}, thumbnail_medium` : BASE_COLUMNS)
    .order("hive_created", { ascending: false, nullsFirst: false })
    .limit(10000)
    .returns<SpotRow[]>();
}

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

  const { data, error } = await selectSpots(true).then((first) =>
    // thumbnail_medium arrives with a web-owned migration. Until it is
    // applied, PostgREST rejects the column (42703); retry without it so the
    // endpoint keeps working before and after the migration.
    first.error && isMissingMediumColumn(first.error) ? selectSpots(false) : first
  );

  if (error) {
    console.error("[GET /api/spotmap] query failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load spots" },
      { status: 500 }
    );
  }

  const rows = data ?? [];
  const spots = rows.map(({ thumbnail_override, thumbnail_small, thumbnail_medium, ...rest }) => {
    const coalescedThumbnail = thumbnail_override || rest.thumbnail;
    return {
      ...rest,
      thumbnail: coalescedThumbnail,
      thumbnail_small: thumbnail_small || coalescedThumbnail,
      // ~800px variant for detail heroes; see src/lib/spotmap-medium.ts.
      thumbnail_medium: thumbnail_medium || coalescedThumbnail,
    };
  });

  // Lazily queue generation for a bounded number of rows the DB doesn't have
  // a small thumbnail for yet, so a few new/edited spots show up without
  // waiting for a backfill run. Wrapped in Next's after() so this can't
  // block (or, on Vercel, get frozen mid-flight behind) the response —
  // resolveSmallThumbnail itself also never throws, so this can't fail the
  // request either way.
  const toQueue = rows
    .filter((row) => !row.thumbnail_small && HTTP_URL_RE.test(row.thumbnail_override || row.thumbnail || ""))
    .slice(0, MAX_LAZY_GENERATIONS_PER_REQUEST);
  if (toQueue.length > 0) {
    after(() => {
      for (const row of toQueue) {
        void resolveSmallThumbnail({
          id: row.id,
          thumbnail: row.thumbnail,
          thumbnail_override: row.thumbnail_override,
          thumbnail_small: row.thumbnail_small,
        });
      }
    });
  }

  return NextResponse.json(
    { success: true, count: spots.length, spots },
    {
      headers: {
        // Edge-cache — sync is manual so freshness pressure is low.
        "Cache-Control":
          "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
