import { describe, expect, it, vi } from "vitest";
import { hiveRpc, RpcError, type FetchLike } from "./hiveRpc";

const NODES = ["https://n1.example", "https://n2.example", "https://n3.example"];

// Echo the request id back like a real node.
function ok(result: unknown): FetchLike {
  return vi.fn(async (_u: string, init: RequestInit) => {
    const { id } = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
  });
}
function streamResponse(chunks: Uint8Array[], opts: { hang?: boolean } = {}) {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else if (!opts.hang) ctrl.close();
      // hang: never close -> the read only ends through the abort
    },
  });
  return new Response(body, { status: 200 }); // no content-length
}
const code = async (p: Promise<unknown>) => { try { await p; return "resolved"; } catch (e) { return (e as RpcError).code; } };

describe("hiveRpc (bounded, no background retries)", () => {
  it("returns the result and posts a JSON-RPC 2.0 call with redirect=error and a signal", async () => {
    const f = ok({ author: "a" });
    expect(await hiveRpc("condenser_api.get_content", ["a", "p"], { nodes: NODES, fetchImpl: f })).toEqual({ author: "a" });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe(NODES[0]);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toMatchObject({ jsonrpc: "2.0", method: "condenser_api.get_content", params: ["a", "p"] });
  });

  it("streamed body WITHOUT content-length over the cap -> too_large, no failover", async () => {
    const big = new Uint8Array(1024).fill(97);
    const f = vi.fn(async () => streamResponse([big, big, big]));
    expect(await code(hiveRpc("m", [], { nodes: NODES, fetchImpl: f, maxBytes: 2000 }))).toBe("too_large");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("declared content-length over the cap -> too_large before reading", async () => {
    const f = vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": "99999999" } }));
    expect(await code(hiveRpc("m", [], { nodes: NODES, fetchImpl: f, maxBytes: 1000 }))).toBe("too_large");
  });

  it("hung body is cut by the per-node timeout (body included), then at most 2 nodes", async () => {
    // A fetch that does NOT error the body on abort: the client must still stop.
    const f = vi.fn(async () => streamResponse([new TextEncoder().encode('{"jsonrpc":"2.0",')], { hang: true }));
    const t0 = Date.now();
    expect(await code(hiveRpc("m", [], { nodes: NODES, fetchImpl: f as any, perNodeTimeoutMs: 30 }))).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(2); // never the 3rd node
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("network error fails over to the next node", async () => {
    const good = ok(42);
    const f = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockImplementation(good);
    expect(await hiveRpc("m", [], { nodes: NODES, fetchImpl: f })).toBe(42);
    expect(f.mock.calls[1][0]).toBe(NODES[1]);
  });

  it("validates jsonrpc/id/result; RPC error stops (no failover)", async () => {
    const wrongId = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: -1, result: 1 })));
    expect(await code(hiveRpc("m", [], { nodes: NODES.slice(0, 1), fetchImpl: wrongId }))).toBe("bad_response");
    const notJson = vi.fn(async () => new Response("<html>"));
    expect(await code(hiveRpc("m", [], { nodes: NODES.slice(0, 1), fetchImpl: notJson }))).toBe("bad_response");
    const rpcErr = vi.fn(async (_u: string, init: RequestInit) => new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(String(init.body)).id, error: { code: -32000 } })));
    expect(await code(hiveRpc("m", [], { nodes: NODES, fetchImpl: rpcErr }))).toBe("rpc_error");
    expect(rpcErr).toHaveBeenCalledTimes(1);
  });

  it("outer abort (batch deadline) cancels the in-flight fetch and starts nothing else", async () => {
    const outer = new AbortController();
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const p = hiveRpc("m", [], { nodes: NODES, fetchImpl: f as any, signal: outer.signal, perNodeTimeoutMs: 5000 });
    setTimeout(() => outer.abort(), 10);
    expect(await code(p)).toBe("aborted");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("already-aborted outer signal: no fetch at all", async () => {
    const outer = new AbortController(); outer.abort();
    const f = vi.fn();
    expect(await code(hiveRpc("m", [], { nodes: NODES, fetchImpl: f as any, signal: outer.signal }))).toBe("aborted");
    expect(f).not.toHaveBeenCalled();
  });
});
