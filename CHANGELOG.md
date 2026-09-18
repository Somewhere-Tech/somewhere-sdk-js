# Changelog

All notable changes to `@somewhere-tech/sdk`.

This project is pre-1.0. Following the repo convention (0.3.0 → 0.4.0 was the
last feature/breaking bump), the **minor** version is the breaking lever until
1.0.0. So a default-semantics change bumps the minor.

## 0.8.0 — The realtime surface is removed

Supersedes 0.7.6.

**Breaking (removal).** `sw.realtime`, `sw.channel(name)`, `createClient(...)
.channel(name)`, the `RealtimeClient` / `RealtimeChannelClient` classes, the
`dispatchRealtimeFrame` helper and the `ChannelStatus`,
`RealtimeBroadcastPayload`, `RealtimeBroadcastResponse` and
`RealtimeMetaResponse` types are gone. There is no alias and no deprecation
shim: the platform retired the caller-named channel API on 2026-09-18, the
`/v1/realtime/*` routes no longer exist (a developer key gets
`403 ROUTE_FORBIDDEN`), and an SDK method that can only fail is worse than no
method. Pre-1.0, the clean contract wins.

### Removed
- `src/resources/realtime.ts` and `src/resources/realtime-reconnect.ts`, with
  their tests and the `Client.realtimeToken` / `Client.wsBaseUrl` accessors
  that existed only to open the channel WebSocket.
- The README's broadcast-channel section and `channel(name)` from the list of
  namespaces the explicit client retains. The README's browser live-view
  guidance stays.
- 0.7.6's reframing of this surface, which had just relabelled the channel API
  as developer-authorized and documented a `403 CHANNEL_FORBIDDEN` refusal for
  app-user and visitor requests. That distinction is moot now that the routes
  themselves are gone: every caller, developer key included, gets
  `403 ROUTE_FORBIDDEN`.

### Notes for upgraders
- **Server-side fan-out and browser subscribe have no SDK replacement in this
  release.** The platform's two signed system channels now live at
  `POST /v1/events/subscribe` and `POST /v1/events/subscribe-user` (MCP:
  `events_subscribe_project`, `events_subscribe_user`). If the SDK grows a
  first-class client for them, that is where it will point — it is deliberately
  not built here.
- **Postgres change streams are unaffected.** `sw.db.live` and `/__sw/live/*`
  are platform surfaces that keep working; this SDK was never their client.
- **The cache's invalidation seam is unaffected.** `sw.invalidate(table)` is
  still public — wire it to whatever change signal your app has. 0.7.5/0.7.6
  changed its internals (generation-fenced cache warming, session-transition
  clearing); the public seam is the same call.
- **0.7.5 and 0.7.6 have no entries below.** Both shipped from master — the db
  query-array adapter, the cache result-shape isolation, and the browser
  authority / live-view doc contracts — and the version moved to 0.7.6 in
  `package.json` without notes being written. Those notes are not this lane's
  to author; the changes are in `9a1a642..97a4ad8`.

## 0.7.4 — Sign-in sets the session cookie by default

### Fixed
- **Sign-in now sets the session cookie by default.** A successful sign-up or
  sign-in through `somewhereAuth` stages the httpOnly session cookies whenever
  the runtime supports them, so the documented browser flow —
  `fetch('/api/auth/login', { credentials: 'include' })`, then
  `fetch('/api/auth/me', { credentials: 'include' })` — signs the user in and
  keeps them signed in, with no token handled in browser code. Previously the
  cookie was set only when the request carried the `X-Sw-Auth-Mode: cookie`
  header, which this SDK's own auth client sends but a plain `fetch` does not:
  sign-up returned 200 with no cookie at all, `/api/auth/me` then answered
  `{ "user": null }`, and every protected route stayed unauthorized.

### Notes for upgraders
- **Nothing you already have changes.** `X-Sw-Auth-Mode` now selects the
  response *body* only. Apps using this SDK's auth client are byte-identical.
  Any other caller — a raw `fetch`, a mobile or server client, a pre-0.2.0
  client — receives the exact response body it received before, now alongside
  a session cookie it is free to ignore.
- **Send `X-Sw-Auth-Mode: token` to opt out** if your backend mints its own
  session cookie from the returned tokens and does not want the platform pair
  set alongside it. Your own cookies are never touched either way: this handler
  only ever adds the platform session pair, and never reads or clears a cookie
  under any other name.

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
