import type { Result } from './types.js';

/**
 * Client-side query cache for the `from().select()` read path.
 *
 * Three jobs, all default-on (the founder's call — see
 * `docs/platform-intelligence.md`):
 *
 *  1. **Request dedup / single-flight.** Two awaits of the same query while
 *     the first is still in flight share ONE network request. Zero staleness
 *     risk — they'd have resolved to the same bytes anyway.
 *  2. **Short staleTime cache (~1s).** A repeat read within `staleTime` of the
 *     last fetch returns the prior result instead of refetching. 1s is the
 *     safety knob: own-writes invalidate (below), normal polling (>1s apart)
 *     stays fresh, only sub-second bursts coalesce.
 *  3. **Invalidate-on-write.** A write to a table drops that table's cached
 *     reads so the next read is fresh (read-your-own-writes correctness).
 *
 * The cache is owned by a single `Client` instance, so it is **auth-scoped for
 * free**: one client = one identity = one cache. Cache keys never cross
 * clients, and signing out (a new client) starts from empty.
 *
 * REALTIME-INVALIDATION SEAM (future, not built here): a realtime event for a
 * table should call {@link QueryCache.invalidate} for that table — the exact
 * same path invalidate-on-write uses. That's the whole integration point.
 */
export interface CacheOptions {
  /** Milliseconds a fetched read stays fresh before a refetch. Default 1000. */
  staleTime?: number;
}

interface CacheEntry {
  value: Result<unknown>;
  storedAt: number;
  table: string;
}

const DEFAULT_STALE_TIME_MS = 1000;

/** Hand back an isolated copy so a caller mutating `.data` can't poison the cache. */
function cloneResult(r: Result<unknown>): Result<unknown> {
  return { ...r, data: r.data === null ? null : structuredClone(r.data) };
}

export class QueryCache {
  private readonly staleTime: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<Result<unknown>>>();
  /**
   * Per-table generation counter. Bumped on every invalidate so a fetch that
   * was already in flight when its table got invalidated does NOT repopulate
   * the cache with a pre-write value.
   */
  private readonly generations = new Map<string, number>();
  private readonly now: () => number;

  constructor(opts: CacheOptions = {}, now: () => number = Date.now) {
    this.staleTime = opts.staleTime ?? DEFAULT_STALE_TIME_MS;
    this.now = now;
  }

  /**
   * Read-through with dedup + staleTime. `run` performs the actual network
   * fetch and is invoked at most once per in-flight key.
   */
  async read(
    key: string,
    table: string,
    run: () => Promise<Result<unknown>>,
  ): Promise<Result<unknown>> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.storedAt < this.staleTime) {
      return cloneResult(hit.value);
    }

    const flight = this.inFlight.get(key);
    if (flight) {
      // Dedup: join the in-flight request instead of starting a second one.
      return cloneResult(await flight);
    }

    const gen = this.generations.get(table) ?? 0;
    const p = (async () => {
      const result = await run();
      // Only cache successes, and only if no invalidate landed mid-flight.
      if (result.error === null && (this.generations.get(table) ?? 0) === gen) {
        this.entries.set(key, { value: result, storedAt: this.now(), table });
      }
      return result;
    })();

    this.inFlight.set(key, p);
    try {
      return cloneResult(await p);
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Store a freshly-fetched result directly. Used by `.fresh()` (a forced
   * network read still warms the cache for the next normal read).
   */
  store(key: string, table: string, result: Result<unknown>): void {
    if (result.error === null) {
      this.entries.set(key, { value: result, storedAt: this.now(), table });
    }
  }

  /**
   * Drop every cached read for a table. Called automatically after a write to
   * that table (read-your-own-writes); also the public realtime/manual seam.
   */
  invalidate(table: string): void {
    this.generations.set(table, (this.generations.get(table) ?? 0) + 1);
    for (const [key, entry] of this.entries) {
      if (entry.table === table) this.entries.delete(key);
    }
  }

  /** Drop the entire cache. */
  clear(): void {
    this.entries.clear();
    for (const table of this.generations.keys()) {
      this.generations.set(table, (this.generations.get(table) ?? 0) + 1);
    }
  }
}
