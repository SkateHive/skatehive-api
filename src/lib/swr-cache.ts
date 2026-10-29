/**
 * Small per-process cache with stale-while-revalidate and request coalescing.
 *
 * - fresh  (age < freshMs):            return the cached value.
 * - stale  (freshMs <= age < staleMs): return the cached value now and refresh
 *                                      it in the background (via `schedule`).
 * - absent or older than staleMs:      run the loader and wait for it.
 *
 * Concurrent callers for the same key share ONE in-flight loader promise, so
 * a client that times out and retries while the first request is still
 * running joins that work instead of starting a duplicate database scan.
 * This only dedupes within one server instance; it is not a shared cache.
 */

export type SwrState = "hit" | "stale" | "miss" | "coalesced";

export interface SwrOptions {
  freshMs: number;
  staleMs: number;
  /** Max entries kept; the oldest entries are dropped first. */
  maxEntries?: number;
  /** Runs background refreshes. Defaults to a detached promise. */
  schedule?: (task: () => Promise<void>) => void;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  storedAt: number;
}

export class SwrCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inFlight = new Map<string, Promise<T>>();
  private readonly opts: Required<Omit<SwrOptions, "schedule">> & Pick<SwrOptions, "schedule">;

  constructor(opts: SwrOptions) {
    this.opts = { maxEntries: 200, now: Date.now, ...opts };
  }

  async get(key: string, loader: () => Promise<T>): Promise<{ value: T; state: SwrState }> {
    const now = this.opts.now();
    const entry = this.entries.get(key);
    const age = entry ? now - entry.storedAt : Infinity;

    if (entry && age < this.opts.freshMs) {
      return { value: entry.value, state: "hit" };
    }

    if (entry && age < this.opts.staleMs) {
      if (!this.inFlight.has(key)) {
        const refresh = async () => {
          try {
            await this.load(key, loader);
          } catch (err) {
            console.error(`[swr-cache] background refresh failed for ${key}:`, err);
          }
        };
        if (this.opts.schedule) this.opts.schedule(refresh);
        else void refresh();
      }
      return { value: entry.value, state: "stale" };
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return { value: await pending, state: "coalesced" };
    }
    return { value: await this.load(key, loader), state: "miss" };
  }

  /** Runs the loader once per key at a time and stores its result. */
  private load(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.opts.now() });
    const now = this.opts.now();
    for (const [k, e] of this.entries) {
      if (this.entries.size <= this.opts.maxEntries && now - e.storedAt < this.opts.staleMs) break;
      this.entries.delete(k);
    }
  }

  /** Test helper. */
  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}
