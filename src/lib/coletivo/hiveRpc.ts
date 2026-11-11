// Small, bounded Hive JSON-RPC client for the read-only engagement path.
// Unlike the shared dhive client it never retries in the background: every
// attempt is one fetch whose headers AND body are covered by an abort signal,
// the body is read as a stream with a hard byte cap, at most `maxNodes` nodes
// are tried, and an outer signal (request / batch deadline) cancels it all.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RpcError extends Error {
  constructor(public code: "timeout" | "too_large" | "bad_response" | "rpc_error" | "network" | "aborted", message?: string) {
    super(message || code);
  }
}

export type RpcOptions = {
  nodes: readonly string[];
  maxNodes?: number; // default 2
  perNodeTimeoutMs?: number; // default 4000
  maxBytes?: number; // default 3 MiB
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
};

let nextId = 1;

async function readCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const declared = Number(res.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.body?.cancel().catch(() => {}); // never awaited: it must not hang
    throw new RpcError("too_large");
  }
  if (!res.body) throw new RpcError("bad_response", "no body");
  const reader = res.body.getReader();
  // Every read races the abort signal, so a hung body ends with the budget
  // even if the fetch implementation does not error the stream on abort.
  let fail: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    fail = () => {
      // Reject FIRST: cancelling resolves the pending read with done=true, and
      // a truncated body must never be parsed as if it were complete.
      reject(signal.reason instanceof RpcError ? signal.reason : new RpcError("timeout"));
      reader.cancel().catch(() => {});
    };
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => {});
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw signal.reason instanceof RpcError ? signal.reason : new RpcError("timeout");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => {}); // not awaited: must not hang on a stuck source
        throw new RpcError("too_large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  } finally {
    signal.removeEventListener("abort", fail);
  }
}

async function attempt(url: string, method: string, params: unknown, o: Required<Omit<RpcOptions, "signal" | "nodes">> & { signal?: AbortSignal }): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new RpcError("timeout")), o.perNodeTimeoutMs);
  const onOuter = () => ctrl.abort(new RpcError("aborted"));
  if (o.signal) {
    if (o.signal.aborted) onOuter();
    else o.signal.addEventListener("abort", onOuter, { once: true });
  }
  const id = nextId++;
  try {
    let res: Response;
    try {
      res = await o.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
        redirect: "error",
        signal: ctrl.signal,
      });
    } catch (e) {
      throw ctrl.signal.aborted ? (ctrl.signal.reason instanceof RpcError ? ctrl.signal.reason : new RpcError("timeout")) : new RpcError("network", (e as Error)?.name);
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {}); // drop the unread body (not awaited)
      throw new RpcError("network", `http ${res.status}`);
    }
    let text: string;
    try {
      text = await readCapped(res, o.maxBytes, ctrl.signal);
    } catch (e) {
      if (e instanceof RpcError) throw e;
      throw ctrl.signal.aborted ? (ctrl.signal.reason instanceof RpcError ? ctrl.signal.reason : new RpcError("timeout")) : new RpcError("network");
    }
    let body: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new RpcError("bad_response", "invalid json");
    }
    if (body?.jsonrpc !== "2.0" || body.id !== id) throw new RpcError("bad_response", "jsonrpc/id mismatch");
    if (body.error !== undefined) throw new RpcError("rpc_error");
    if (!("result" in body)) throw new RpcError("bad_response", "no result");
    return body.result;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onOuter);
    // Always end the request: after success the body is fully read already;
    // on any error path this tears down the connection and any unread body.
    ctrl.abort(new RpcError("aborted"));
  }
}

/**
 * Call `method` on up to `maxNodes` nodes in order. Fails over on network,
 * timeout, http and malformed-response errors; a too-large body, an RPC error
 * or an outer abort stops immediately (another node would not help, or we are
 * out of time).
 */
export async function hiveRpc(method: string, params: unknown, opts: RpcOptions): Promise<unknown> {
  const o = {
    maxNodes: opts.maxNodes ?? 2,
    perNodeTimeoutMs: opts.perNodeTimeoutMs ?? 4000,
    maxBytes: opts.maxBytes ?? 3 * 1024 * 1024,
    fetchImpl: opts.fetchImpl ?? fetch,
    signal: opts.signal,
  };
  let last: RpcError = new RpcError("network", "no nodes");
  for (const url of opts.nodes.slice(0, o.maxNodes)) {
    if (o.signal?.aborted) throw new RpcError("aborted");
    try {
      return await attempt(url, method, params, o);
    } catch (e) {
      last = e instanceof RpcError ? e : new RpcError("network");
      if (last.code === "too_large" || last.code === "rpc_error" || last.code === "aborted") throw last;
    }
  }
  throw last;
}
