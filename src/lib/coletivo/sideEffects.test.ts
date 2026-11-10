import { describe, expect, it, vi } from "vitest";
import { drainOutbox, type OutboxDeps, type OutboxItem } from "./sideEffects";

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  outbox_id: "o1", claim_token: "c1", kind: "soft_post", post_id: "p1", post_user_id: "u1",
  publish_author: "skateuser", publish_permlink: "coletivoxv-p1", publish_signer_kind: "shared_default",
  title: null, body: "x", media: [{ type: "image", url: "https://images.hive.blog/a.jpg" }], ...over,
});

function deps(queues: Partial<Record<string, OutboxItem[]>>, over: Partial<OutboxDeps> = {}): OutboxDeps {
  const q: Record<string, OutboxItem[]> = { soft_post: queues.soft_post || [], instagram_enqueue: queues.instagram_enqueue || [] };
  return {
    claim: vi.fn(async (kind, limit) => q[kind].splice(0, limit)),
    complete: vi.fn(async () => {}),
    recordSoftPost: vi.fn(async () => {}),
    enqueueCrosspost: vi.fn(async () => "q1"),
    linkCrosspost: vi.fn(async () => {}),
    ...over,
  };
}

describe("drainOutbox", () => {
  it("records attribution, queues + links Instagram, completes each claim", async () => {
    const d = deps({ soft_post: [item()], instagram_enqueue: [item({ outbox_id: "o2", kind: "instagram_enqueue" })] });
    expect(await drainOutbox(d, { limitPerKind: 10, deadlineMs: 1000 })).toMatchObject({ claimed: 2, done: 2, errors: 0 });
    expect(d.linkCrosspost).toHaveBeenCalledWith("p1", "q1");
    expect(d.complete).toHaveBeenCalledTimes(2);
  });

  it("own-key soft_post and text-only instagram are completed as skipped", async () => {
    const d = deps({ soft_post: [item({ publish_signer_kind: "own_key" })], instagram_enqueue: [item({ kind: "instagram_enqueue", media: [] })] });
    expect(await drainOutbox(d, { limitPerKind: 10, deadlineMs: 1000 })).toMatchObject({ skipped: 2, done: 0 });
    expect(d.recordSoftPost).not.toHaveBeenCalled();
    expect(d.enqueueCrosspost).not.toHaveBeenCalled();
    expect(d.complete).toHaveBeenCalledWith(expect.anything(), true, undefined, { skipped: true });
  });

  it("a failure is reported (DB backs off and retries); other items still run", async () => {
    const d = deps(
      { soft_post: [item(), item({ outbox_id: "o3" })] },
      { recordSoftPost: vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(undefined) }
    );
    expect(await drainOutbox(d, { limitPerKind: 10, deadlineMs: 1000 })).toMatchObject({ done: 1, errors: 1 });
    expect(d.complete).toHaveBeenCalledWith(expect.objectContaining({ outbox_id: "o1" }), false, "soft_post_failed");
  });

  it("one claim at a time; batch size per kind respected", async () => {
    const d = deps({ soft_post: [item(), item(), item()] });
    await drainOutbox(d, { limitPerKind: 2, deadlineMs: 1000 });
    expect(d.claim).toHaveBeenCalledTimes(3); // 2 soft_post + 1 empty instagram
    for (const call of (d.claim as ReturnType<typeof vi.fn>).mock.calls) expect(call[1]).toBe(1);
  });

  it("budget is checked before EVERY claim: no new work once spent", async () => {
    let t = 0;
    const d = deps({ soft_post: [item(), item(), item()], instagram_enqueue: [item({ kind: "instagram_enqueue" })] }, {
      now: () => t,
      recordSoftPost: vi.fn(async () => { t += 600; }),
    });
    const r = await drainOutbox(d, { limitPerKind: 10, deadlineMs: 1000 });
    expect(r).toMatchObject({ claimed: 2, done: 2, stoppedByDeadline: true });
    expect(d.claim).toHaveBeenCalledTimes(2);
  });

  it("a hung handler is cut by the per-call timeout and reported as retryable", async () => {
    const d = deps({ soft_post: [item()] }, { recordSoftPost: () => new Promise(() => {}) });
    const r = await drainOutbox(d, { limitPerKind: 1, deadlineMs: 1000, callTimeoutMs: 20 });
    expect(r).toMatchObject({ errors: 1, done: 0 });
    expect(d.complete).toHaveBeenCalledWith(expect.objectContaining({ outbox_id: "o1" }), false, "timeout");
  });

  it("never touches Hive: no broadcast dependency exists in this module", async () => {
    const d = deps({});
    expect(Object.keys(d)).not.toContain("broadcast");
    expect(await drainOutbox(d, { limitPerKind: 1, deadlineMs: 1000 })).toMatchObject({ claimed: 0 });
  });
});
