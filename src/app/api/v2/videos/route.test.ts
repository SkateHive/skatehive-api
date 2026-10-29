import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// One HAFSQL row = one post with one IPFS video and a metadata thumbnail.
function postRow(i: number) {
  return {
    author: `skater${i}`,
    permlink: `clip-${i}`,
    title: "",
    created: new Date(Date.UTC(2026, 9, 29) - i * 60_000).toISOString(),
    post_json_metadata: JSON.stringify({ image: [`https://images.hive.blog/DQm${i}/t.jpg`] }),
    body: `<iframe src="https://ipfs.skatehive.app/ipfs/bafybeig${String(i).padStart(4, "0")}"></iframe>`,
    pending_payout_value: "0.000 HBD",
    total_payout_value: "0.000 HBD",
    children: 0,
    votes: [],
  };
}

async function loadRoute(executeQuery: (query: string, params: any[]) => Promise<{ rows: any[]; headers: string[] }>) {
  const exec = vi.fn(executeQuery);
  vi.doMock("@/lib/hafsql_database", () => ({
    HAFSQL_Database: class {
      executeQuery = exec;
    },
  }));
  vi.doMock("@/lib/video-thumbnails", () => ({
    resolveThumbnails: vi.fn(async (videos: any[]) => videos),
  }));
  const scheduled: Array<() => Promise<void>> = [];
  vi.doMock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: (task: () => Promise<void>) => { scheduled.push(task); } };
  });
  vi.resetModules();
  const { GET } = await import("./route");
  return { GET, exec, scheduled };
}

const url = (q: string) => new NextRequest(`https://api.test/api/v2/videos?${q}`);
const offsetOf = (params: any[]) => params.find((p) => p.name === "offset").value;

describe("GET /api/v2/videos", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/hafsql_database");
    vi.doUnmock("@/lib/video-thumbnails");
    vi.doUnmock("next/server");
  });

  it("runs ONE scan for concurrent identical requests (client timeout + retries)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { GET, exec } = await loadRoute(async (_q, params) => {
      await gate;
      const offset = offsetOf(params);
      return { rows: Array.from({ length: 90 }, (_, i) => postRow(offset + i)), headers: [] };
    });

    const requests = [GET(url("page=1&limit=30")), GET(url("page=1&limit=30")), GET(url("page=1&limit=30"))];
    release();
    const responses = await Promise.all(requests);

    expect(exec).toHaveBeenCalledTimes(1);
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(30);
    }
    const timings = responses.map((r) => r.headers.get("server-timing") || "");
    expect(timings.filter((t) => t.includes('cache;desc="miss"'))).toHaveLength(1);
    expect(timings.filter((t) => t.includes('cache;desc="coalesced"'))).toHaveLength(2);
  });

  it("page 2 reuses the batch page 1 already loaded", async () => {
    const { GET, exec } = await loadRoute(async (_q, params) => {
      const offset = offsetOf(params);
      return { rows: Array.from({ length: 90 }, (_, i) => postRow(offset + i)), headers: [] };
    });

    const p1 = await (await GET(url("page=1&limit=30"))).json();
    const p2 = await (await GET(url("page=2&limit=30"))).json();

    expect(exec).toHaveBeenCalledTimes(1); // both pages fit in the first 90-post batch
    expect(p1.data[0].permlink).toBe("clip-0");
    expect(p2.data[0].permlink).toBe("clip-30");
    expect(p2.pagination).toMatchObject({ currentPage: 2, hasNextPage: true, nextPage: 3 });
  });

  it("serves a stale page instantly and refreshes it after the response", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    let generation = 0;
    const { GET, exec, scheduled } = await loadRoute(async (_q, params) => {
      generation++;
      const offset = offsetOf(params);
      return { rows: Array.from({ length: 90 }, (_, i) => ({ ...postRow(offset + i), title: `gen${generation}` })), headers: [] };
    });

    await GET(url("page=1&limit=30"));
    vi.setSystemTime(new Date("2026-10-29T12:02:00Z")); // past fresh, inside stale

    const stale = await GET(url("page=1&limit=30"));
    expect((await stale.json()).data[0].title).toBe("gen1");
    expect(stale.headers.get("server-timing")).toContain('cache;desc="stale"');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    const fresh = await GET(url("page=1&limit=30"));
    expect((await fresh.json()).data[0].title).toBe("gen2");
    expect(fresh.headers.get("server-timing")).toContain('cache;desc="hit"');
  });

  it("does not start a background refresh on a fresh hit", async () => {
    const { GET, scheduled } = await loadRoute(async (_q, params) => {
      const offset = offsetOf(params);
      return { rows: Array.from({ length: 90 }, (_, i) => postRow(offset + i)), headers: [] };
    });
    await GET(url("page=1&limit=30"));
    await GET(url("page=1&limit=30"));
    expect(scheduled).toHaveLength(0);
  });

  it("sends edge-cache headers with a stale-while-revalidate window", async () => {
    const { GET } = await loadRoute(async () => ({ rows: [postRow(0)], headers: [] }));
    const res = await GET(url("page=1&limit=30"));
    expect(res.headers.get("cdn-cache-control")).toBe("s-maxage=60, stale-while-revalidate=300");
    expect(res.headers.get("cache-control")).toBe("s-maxage=60, stale-while-revalidate=300");
  });

  it("returns 500 without caching when the database fails, then recovers", async () => {
    let fail = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await loadRoute(async () => {
      if (fail) throw new Error("db down");
      return { rows: [postRow(0)], headers: [] };
    });
    expect((await GET(url("page=1&limit=30"))).status).toBe(500);
    fail = false;
    expect((await GET(url("page=1&limit=30"))).status).toBe(200);
    errSpy.mockRestore();
  });
});
