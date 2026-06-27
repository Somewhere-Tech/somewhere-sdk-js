# SDK Cache Lane — Handoff (tsk_bbcbbad3)

**Branch:** `feat/cache` · **Status:** built, tested, committed — **NOT published.**
**Do not publish without founder review** (this changes default `from().select()`
semantics — a breaking change).

---

## What shipped

Default-on client caching in the `from().select()` query path. Apps get faster
with zero code changes; opt-outs are provided for the rare always-fresh need.

| Behaviour | Default | Notes |
|---|---|---|
| **Request dedup / single-flight** | on | Two awaits of the same query in flight share one request. |
| **staleTime read cache** | on, **1000 ms** | Repeat read within the window served from memory. Client-instance scoped ⇒ **auth-scoped for free**. |
| **Invalidate-on-write** | on | A successful insert/upsert/update/delete drops that table's cached reads (read-your-own-writes). |
| **Per-query opt-out** | `.fresh()` | Always hits the network; still warms the cache. |
| **Global opt-out** | `{ cache: false }` | Pre-0.5.0 semantics — every read fetches. Disables dedup too. |
| **Tuning** | `{ cache: { staleTime } }` | |
| **Prefetch** | `client.prefetch(query)` | Warm ahead of need (hover/route preload). |
| **Manual / realtime seam** | `client.invalidate(table)` | Public seam for the future realtime → cache auto-invalidation. |

Cache key = `project + table + columns + filters + order + limit/offset +
resolveType`. Only the Supabase builder `from().select()` is cached — raw
`sw.db.query(sql, params)` is **never** cached.

### API surface (additions, all backward-additive except the default change)

- `createClient(url, key, { cache })` and `new Somewhere({ cache })` —
  `cache?: boolean | { staleTime?: number }` (default on).
- `PostgrestFilterBuilder.fresh()` — per-query opt-out modifier.
- `Somewhere.prefetch<T>(query): Promise<Result<T>>`.
- `Somewhere.invalidate(table): void` and `Client.invalidateTable(table)`.
- `Client.cache: QueryCache | null` (public; `null` when disabled).
- Exported: `QueryCache` class, `CacheOptions` + `CacheConfig` types.

### Realtime-invalidation seam (designed, NOT built — per brief)

`client.invalidate(table)` is the integration point. A future realtime
`postgres_changes` handler calls it to auto-refresh a table's cached reads.
Documented in README ("Manual + realtime invalidation") and
`docs/platform-intelligence.md` (roadmap). Nothing realtime is wired in 0.5.0.

---

## Semver: 0.4.0 → **0.5.0** (my choice — please confirm)

The brief allowed 0.5.0 **or** 1.0.0. I chose **0.5.0** because:
- The repo's own convention treats the pre-1.0 **minor** as the breaking lever
  (0.3.0 → 0.4.0 was the last feature/breaking bump). 0.4 → 0.5 matches it.
- Declaring 1.0.0 is an API-stability commitment to the ecosystem — a
  positioning call that's the founder's to make at publish time, not mine.

If you'd rather signal "this is the stable, cache-by-default 1.0," bump to
1.0.0 before publish. `CHANGELOG.md` documents the breaking default + opt-outs.

---

## Gates — both green

```
npm run build   → exit 0
npm test        → exit 0   (typecheck + realtime + supabase-shape + cache + live-skip)
```

**Tests added** (`test/unit-cache.mjs`, pure / no-network, 15 assertions, wired
into `npm test`):
- dedup: 2 concurrent identical awaits → **1** fetch
- staleTime: repeat read within window → **1** fetch (+ default-on proof, + key isolation)
- invalidate-on-write: write then read → **fresh** (2 reads despite staleTime;
  + a write to another table leaves the cache intact)
- opt-out: `cache:false` → every read fetches; `.fresh()` → every read fetches
  (+ `.fresh()` still warms the cache)
- prefetch warms the cache; cache hits are isolated copies (no mutation poisoning)

TDD was followed: the suite was written first and watched fail (RED) before the
implementation (GREEN).

---

## Files

**Implementation**
- `src/query-cache.ts` — **new.** `QueryCache` (dedup + staleTime + invalidate,
  per-table generation guard so an in-flight fetch can't repopulate after an
  invalidate).
- `src/resources/postgrest.ts` — executor routes through the cache; `doFetch()`
  split out; `cacheKey()`; `.fresh()` modifier.
- `src/client.ts` — owns `cache`, builds it from the option, `invalidateTable()`.
- `src/index.ts` — `Somewhere.prefetch()` / `invalidate()`; `createClient`
  forwards `cache`; exports `QueryCache` / `CacheOptions`.
- `src/types.ts` — `CacheConfig` type; `cache?` on both options interfaces.
- `package.json` — version 0.5.0; `unit-cache.mjs` + `unit-supabase-shape.mjs`
  added to the `test` script.

**Docs / sales**
- `README.md` — "Caching — fast by default" section + table row.
- `docs/platform-intelligence.md` — **new.** Sales/positioning ("what's next
  after Next.js" / platform intelligence). Persuasion asset.
- `CHANGELOG.md` — **new.** 0.5.0 entry (breaking default + opt-outs).

**Tests**
- `test/unit-cache.mjs` — **new.** The cache suite.
- `test/basic.test.ts` — rewrote to compile (see "pre-existing" below).

---

## What the founder must review before publish

1. **The default-on decision is breaking.** Sub-second repeat reads can return
   the same bytes. We judge this safe (1s window + write-invalidation), but it
   IS a behaviour change for every consumer. Confirm you want it default-on vs.
   opt-in (`cache: false` as default).
2. **Semver:** confirm **0.5.0** vs. 1.0.0 (see above).
3. **Sales copy:** `docs/platform-intelligence.md` makes competitive claims
   ("what's next after Next.js"). Review tone/claims before it's public.
4. **staleTime = 1000 ms:** confirm the default window.
5. **Clone-on-hit** uses `structuredClone` (Node ≥18 / modern browsers — already
   the package's floor). Returned cache hits are deep-copied so callers can't
   mutate cached rows. Fine for JSON row data; no `Date`/`Map` round-trip concern
   from `/db/query`.

### Pre-existing issues found (NOT introduced by this lane — flagging only)

- **`npm test` was already red before this lane:** `test/basic.test.ts`
  referenced a removed `projects`/`deploy` SDK surface (left stale by the
  Supabase migration) and failed the typecheck. I verified this fails identically
  with my changes stashed, then rewrote `basic.test.ts` into a typed compile-check
  of the current surface so the gate is green. `test/run-basic.mjs` still calls
  the same removed `sw.projects`/`sw.deploy` APIs but is inert in CI (it
  `exit(0)`s without `SMT_KEY`); it needs a separate cleanup pass.
- **Stale committed build artifacts in `src/`:** `src/index.js`, `src/client.js`,
  `src/errors.js`, `src/types.js` are old compiled outputs (e.g. `index.js`
  imports a long-gone `AiResource`). Nothing uses them (build → `dist/`, tests →
  `dist/esm`). Left untouched per "don't delete what you didn't create"; worth a
  cleanup commit + adding `src/**/*.js` to `.gitignore`.

---

## Guardrails honored

- ❌ No publish, no version tag push. ✅ Committed to `feat/cache` only. ✅
  `master` untouched. ✅ Nothing deployed.
