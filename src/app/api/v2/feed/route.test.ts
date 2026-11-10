import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The community feed must pick the page BEFORE joining votes: joining every
// vote of every snap and grouping before LIMIT took ~50s and returned 500.
const queries: { sql: string; inputs: { name: string; value: unknown }[] }[] = [];

vi.mock("@/lib/hafsql_database", () => ({
  HAFSQL_Database: class {
    getActiveConnections() {
      return 0;
    }
    async executeQuery(sql: string, inputs: { name: string; value: unknown }[] = []) {
      queries.push({ sql, inputs });
      if (sql.includes("COUNT(*) AS total")) return { rows: [{ total: "42" }], headers: [] };
      return { rows: [], headers: [] };
    }
  },
}));
vi.mock("@/lib/soft-posts", () => ({ dealiasSoftPosts: async (rows: unknown[]) => rows }));

describe("GET /api/v2/feed", () => {
  it("limits the page before looking up votes, replies and accounts", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v2/feed?limit=10&page=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toMatchObject({ currentPage: 2, limit: 10, total: 42, hasNextPage: true });

    const main = queries.find((q) => q.sql.includes("WITH page AS"));
    expect(main, "main query uses a page CTE").toBeTruthy();
    const sql = main!.sql;
    const pageCte = sql.slice(sql.indexOf("WITH page AS"), sql.indexOf("SELECT", sql.indexOf(")\n    SELECT")));
    // LIMIT/OFFSET live inside the page CTE, which reads comments only.
    expect(pageCte).toMatch(/LIMIT @limit\s+OFFSET @offset/);
    expect(pageCte).not.toMatch(/operation_effective_comment_vote_view|accounts/);
    // No full-community aggregate: votes come from a per-row subquery.
    expect(sql).not.toMatch(/GROUP BY/);
    expect(sql).not.toMatch(/SIMILAR TO/);
    expect(main!.inputs).toEqual(
      expect.arrayContaining([
        { name: "limit", value: 10 },
        { name: "offset", value: 10 },
      ])
    );
  });
});
