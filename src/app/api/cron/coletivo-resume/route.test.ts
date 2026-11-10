import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const resumeColetivo = vi.hoisted(() => vi.fn(async () => ({ published: 0 })));
vi.mock("@/lib/coletivo/service", () => ({ resumeColetivo }));

const call = async (auth?: string) => {
  const { GET } = await import("./route");
  return GET(new NextRequest("http://localhost/api/cron/coletivo-resume", { headers: auth ? { authorization: auth } : {} }));
};

describe("cron/coletivo-resume (optional, unscheduled)", () => {
  afterEach(() => { vi.unstubAllEnvs(); resumeColetivo.mockClear(); });
  it("fails closed without CRON_SECRET, with a short one, or a wrong bearer", async () => {
    expect((await call("Bearer x")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(resumeColetivo).not.toHaveBeenCalled();
  });
  it("runs a bounded resume with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect((await call(`Bearer ${"s".repeat(32)}`)).status).toBe(200);
    expect(resumeColetivo).toHaveBeenCalledWith({ maxPublishes: 5, deadlineMs: 40000 });
  });
});
