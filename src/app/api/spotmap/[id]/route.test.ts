import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeResult } from "@/test/fakeSupabase";

async function loadRoute(supabase: Record<string, FakeResult[]>) {
  vi.doMock("@/app/utils/supabase/supabaseClient", () => ({ supabaseAdmin: makeFakeSupabase(supabase) }));
  vi.resetModules();
  return (await import("./route")).GET;
}

const req = (id: string) => new NextRequest(`https://api.test/api/spotmap/${id}`);

describe("GET /api/spotmap/[id]", () => {
  it("keeps the raw row and adds the size-bounded fields", async () => {
    const GET = await loadRoute({
      spotmap_spots: [{ data: { id: "x", thumbnail: "https://full/x.png", thumbnail_override: "https://o/x.jpg", thumbnail_small: "https://s/x.jpg", thumbnail_medium: null, images: ["https://g/1"] }, error: null }],
    });
    const body = await (await GET(req("x"))).json();
    expect(body.spot).toMatchObject({
      id: "x", thumbnail: "https://full/x.png", thumbnail_override: "https://o/x.jpg", images: ["https://g/1"],
      thumbnail_medium: null, thumbnail_bounded: "https://s/x.jpg", thumbnail_bounded_kind: "small",
    });
  });

  it("works on rows from before the medium migration, never offering the original as bounded", async () => {
    const GET = await loadRoute({ spotmap_spots: [{ data: { id: "y", thumbnail: "https://full/y.png" }, error: null }] });
    const body = await (await GET(req("y"))).json();
    expect(body.spot).toMatchObject({ thumbnail: "https://full/y.png", thumbnail_medium: null, thumbnail_bounded: null, thumbnail_bounded_kind: null });
  });

  it("404s an unknown spot", async () => {
    const GET = await loadRoute({ spotmap_spots: [{ data: null, error: null }] });
    expect((await GET(req("nope"))).status).toBe(404);
  });
});
