# Changelog

All notable changes to `@somewhere-tech/sdk`.

This project is pre-1.0. Following the repo convention (0.3.0 → 0.4.0 was the
last feature/breaking bump), the **minor** version is the breaking lever until
1.0.0. So a default-semantics change bumps the minor.

## 0.5.0 — Default-on query cache ("platform intelligence")

**Breaking (default behaviour change): `from().select()` is now cached by
default.** Apps get faster with zero code changes; the trade-off is that two
reads within ~1s can return the same bytes. Read-your-own-writes stays correct
(writes self-invalidate). Opt out per-query with `.fresh()` or globally with
`createClient(url, key, { cache: false })`.

### Added
- **Request dedup / single-flight** (always on when caching is enabled): two
  awaits of the same query while the first is in flight share ONE network
  request.
- **Short staleTime cache** (default **1000 ms**, client-instance scoped, so
  auth-scoped for free): a repeat read within the window is served from cache
  instead of refetching. Cache key = project + table + columns + filters +
  order + limit/offset + resolveType.
- **Invalidate-on-write**: a successful `insert`/`upsert`/`update`/`delete`
  drops that table's cached reads, so the next read is fresh.
- **`.fresh()`** modifier on a select — per-query opt-out (always hits the
  network; still warms the cache for the next normal read).
- **`createClient(url, key, { cache })`** — `false` to disable, or
  `{ staleTime }` to tune. Also on `new Somewhere({ cache })`.
- **`client.prefetch(query)`** — warm the cache ahead of need (hover-prefetch,
  route preload).
- **`client.invalidate(table)`** — manual cache drop; also the public seam for
  realtime-driven invalidation (a future realtime event for a table can call
  this — not built in 0.5.0, designed for).
- Exported `QueryCache` and the `CacheOptions` / `CacheConfig` types.

### Notes for upgraders
- Caching only affects the Supabase-style builder `from().select()`. Raw
  `sw.db.query(sql, params)` is **never** cached.
- If you depend on every `.select()` hitting the network (e.g. you poll
  sub-second and need each result fresh), set `{ cache: false }` or use
  `.fresh()`.
- The cache is per `createClient` instance and in-memory only — no cross-tab or
  persistent storage, and it resets when you create a new client (e.g. after a
  sign-in that swaps identity).
