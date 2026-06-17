import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";

// One spot to feature, picked at the edge from a pool of candidates so the
// rotation feels fresh. Mirrored from skatehive3.0 onto api.skatehive.app.
//   1. If lat/lng given: bounding-box prefilter, haversine in JS, keep the
//      NEAREST_POOL within MAX_KM, random pick.
//   2. Fallback: random pick from the newest RANDOM_POOL spots.
//   3. `exclude=ID1,ID2,...` skips spots the caller has already seen.

const NEAREST_POOL = 10;
const BBOX_DEGREES = 0.5; // ~55km square, index-friendly prefilter
const MAX_KM = 80;
const RANDOM_POOL = 30;

interface SpotRow {
  id: string;
  source: "hive" | "google_my_maps";
  name: string;
  lat: number;
  lng: number;
  thumbnail: string | null;
  hive_author: string | null;
  hive_permlink: string | null;
  hive_created: string | null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: "Spot map backend not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = req.nextUrl;
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const exclude = (searchParams.get("exclude") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const lat = latStr != null ? parseFloat(latStr) : NaN;
  const lng = lngStr != null ? parseFloat(lngStr) : NaN;
  const hasGeo =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const selectCols =
    "id, source, name, lat, lng, thumbnail, hive_author, hive_permlink, hive_created";

  let pool: (SpotRow & { distance_km: number })[] = [];
  let isNearby = false;

  if (hasGeo) {
    let q = supabaseAdmin
      .from("spotmap_spots")
      .select(selectCols)
      .gte("lat", lat - BBOX_DEGREES)
      .lte("lat", lat + BBOX_DEGREES)
      .gte("lng", lng - BBOX_DEGREES)
      .lte("lng", lng + BBOX_DEGREES)
      .limit(100);
    if (exclude.length) q = q.not("id", "in", `(${exclude.join(",")})`);
    const { data, error } = await q;
    if (error) {
      console.error("[/api/spotmap/featured] nearest query failed", error);
    } else if (data) {
      const withDist = (data as unknown as SpotRow[])
        .map((s) => ({ ...s, distance_km: haversineKm(lat, lng, s.lat, s.lng) }))
        .filter((s) => s.distance_km <= MAX_KM)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, NEAREST_POOL);
      pool = withDist;
      isNearby = pool.length > 0;
    }
  }

  if (pool.length === 0) {
    let q = supabaseAdmin
      .from("spotmap_spots")
      .select(selectCols)
      .order("hive_created", { ascending: false, nullsFirst: false })
      .limit(RANDOM_POOL);
    if (exclude.length) q = q.not("id", "in", `(${exclude.join(",")})`);
    const { data, error } = await q;
    if (error) {
      console.error("[/api/spotmap/featured] fallback query failed", error);
    } else if (data) {
      pool = (data as unknown as SpotRow[]).map((s) => ({
        ...s,
        distance_km: hasGeo ? haversineKm(lat, lng, s.lat, s.lng) : Number.NaN,
      }));
    }
  }

  const spot = pickRandom(pool);
  if (!spot) {
    return NextResponse.json(
      { success: false, error: "No spots available" },
      { status: 404 }
    );
  }

  const cacheHeader = exclude.length
    ? "no-store"
    : "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

  return NextResponse.json(
    { success: true, spot, isNearby, pool_size: pool.length },
    { headers: { "Cache-Control": cacheHeader } }
  );
}
