import type { Result } from './types.js';

/**
 * Client-side query cache for the `from().select()` read path.
 *
 * Three jobs, all default-on (the founder's call — see
 * `docs/platform-intelligence.md`):
 *
 *  1. **Request dedup / single-flight.** Two awaits of the same query while
 *     the first is still in flight share ONE network request within a generation.
 *  2. **Short staleTime cache (~1s).** A repeat read within `staleTime` of the
 *     last fetch returns the prior result instead of refetching. 1s is the
 *     safety knob: own-writes invalidate (below), normal polling (>1s apart)
 *     stays fresh, only sub-second bursts coalesce.
 *  3. **Invalidate-on-write.** A write to a table drops that table's cached
 *     reads so the next read is fresh (read-your-own-writes correctness).
 *
 * The cache is owned by a single `Client` instance. Session transitions
 * clear its entries and detach pending reads from the next session.
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

interface InFlightRead {
  promise: Promise<Result<unknown>>;
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
  private readonly inFlight = new Map<string, InFlightRead>();
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
   * fetch and is invoked at most once per in-flight key and generation.
   * `fresh` bypasses hits and dedup but still fences cache warming on invalidation.
   */
  async read(
    key: string,
    table: string,
    run: () => Promise<Result<unknown>>,
    fresh = false,
  ): Promise<Result<unknown>> {
    const hit = this.entries.get(key);
    if (!fresh && hit && this.now() - hit.storedAt < this.staleTime) {
      return cloneResult(hit.value);
    }

    const flight = this.inFlight.get(key);
    if (!fresh && flight) {
      // Dedup: join the in-flight request instead of starting a second one.
      return cloneResult(await flight.promise);
    }

    const gen = this.generations.get(table) ?? 0;
    this.generations.set(table, gen);
    const p = (async () => {
      const result = await run();
      // Only cache successes, and only if no invalidate landed mid-flight.
      if (result.error === null && (this.generations.get(table) ?? 0) === gen) {
        this.entries.set(key, { value: cloneResult(result), storedAt: this.now(), table });
      }
      return result;
    })();

    if (!fresh) this.inFlight.set(key, { promise: p, table });
    try {
      return cloneResult(await p);
    } finally {
      if (this.inFlight.get(key)?.promise === p) this.inFlight.delete(key);
    }
  }

  /**
   * Store a current result directly. Reads that can overlap invalidation
   * should use `read` so their cache warming is generation-checked.
   */
  store(key: string, table: string, result: Result<unknown>): void {
    if (result.error === null) {
      this.entries.set(key, { value: cloneResult(result), storedAt: this.now(), table });
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
    for (const [key, flight] of this.inFlight) {
      if (flight.table === table) this.inFlight.delete(key);
    }
  }

  /** Drop the entire cache and detach pending reads. */
  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    for (const table of this.generations.keys()) {
      this.generations.set(table, (this.generations.get(table) ?? 0) + 1);
    }
  }
}
