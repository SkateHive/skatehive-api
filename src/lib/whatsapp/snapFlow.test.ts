import { describe, expect, it, vi } from "vitest";
import { runSnapFlow, type SnapFlowDeps } from "./snapFlow";

function deps(over: Partial<SnapFlowDeps> = {}) {
  const d = {
    reserve: vi.fn(async () => ({ ok: true as const, id: 7 })),
    broadcast: vi.fn(async () => {}),
    onChain: vi.fn(async () => null as boolean | null),
    settle: vi.fn(async () => {}),
    afterPublish: vi.fn(async () => {}),
    ...over,
  };
  return d;
}

describe("runSnapFlow", () => {
  it("publishes: reserve -> broadcast -> settle published -> after-publish", async () => {
    const d = deps();
    expect(await runSnapFlow(d)).toEqual({ ok: true });
    expect(d.settle).toHaveBeenCalledWith(7, "published");
    expect(d.afterPublish).toHaveBeenCalled();
  });
  it("never broadcasts when the day is full", async () => {
    const d = deps({ reserve: vi.fn(async () => ({ ok: false as const, reason: "daily_limit" as const })) });
    expect(await runSnapFlow(d)).toEqual({ ok: false, status: 429, code: "daily_limit" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });
  it("never broadcasts when the reservation errors", async () => {
    const d = deps({ reserve: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await runSnapFlow(d)).toEqual({ ok: false, status: 503, code: "unavailable" });
    expect(d.broadcast).not.toHaveBeenCalled();
  });
  it("keeps a confirmed broadcast charged even when settling fails", async () => {
    const d = deps({ settle: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await runSnapFlow(d)).toEqual({ ok: true });
    expect(d.settle).toHaveBeenCalledWith(7, "published");
    expect(d.settle).not.toHaveBeenCalledWith(7, "failed");
  });
  it("releases the slot only when the post is proven absent", async () => {
    const d = deps({ broadcast: vi.fn(async () => { throw new Error("rpc"); }), onChain: vi.fn(async () => false) });
    expect(await runSnapFlow(d)).toEqual({ ok: false, status: 502, code: "broadcast_failed" });
    expect(d.settle).toHaveBeenCalledWith(7, "failed");
    expect(d.afterPublish).not.toHaveBeenCalled();
  });
  it("treats a failed broadcast that landed on chain as published", async () => {
    const d = deps({ broadcast: vi.fn(async () => { throw new Error("timeout"); }), onChain: vi.fn(async () => true) });
    expect(await runSnapFlow(d)).toEqual({ ok: true });
    expect(d.settle).toHaveBeenCalledWith(7, "published");
    expect(d.afterPublish).toHaveBeenCalled();
  });
  it("leaves the slot charged when the outcome is unknown", async () => {
    for (const onChain of [vi.fn(async () => null), vi.fn(async () => { throw new Error("rpc"); })]) {
      const d = deps({ broadcast: vi.fn(async () => { throw new Error("timeout"); }), onChain });
      expect(await runSnapFlow(d)).toEqual({ ok: false, status: 502, code: "broadcast_unconfirmed" });
      expect(d.settle).not.toHaveBeenCalled();
    }
  });
});
