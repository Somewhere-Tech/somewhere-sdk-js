# Changelog

All notable changes to `@somewhere-tech/sdk`.

This project is pre-1.0. Following the repo convention (0.3.0 → 0.4.0 was the
last feature/breaking bump), the **minor** version is the breaking lever until
1.0.0. So a default-semantics change bumps the minor.

## Unreleased — session status, and sign-in/sign-out that cannot land out of order

Default-semantics changes (per the convention above this is a minor bump;
the version is set at release).

### Added
- `auth.getState()` and the `onChange` argument report `status`:
  `'checking'` (no answer yet; a cached user is unverified), `'authenticated'`,
  `'signed-out'`, or `'indeterminate'` (the check failed on a network error, a
  non-401 error status or an unreadable body; `user` is the last-known
  identity, unverified), plus `error` (`SESSION_CHECK_FAILED`,
  `SIGN_OUT_UNCONFIRMED`) and `signOutUnconfirmed`. `useAuthState()` in
  `@somewhere-tech/sdk/react` returns the same plus `recheck()`.
- `createSomewhereAuth({ mutationTimeoutMs })` bounds one queued sign-in or
  sign-out call, including reading the response and any follow-up `/me`
  (default 30000 ms; `AUTH_TIMEOUT`). Values outside 1–2147483647 ms throw
  `RangeError`.

### Changed
- A `/me` answer, a 401, or a header-mode token rotation that started before a
  newer sign-in or `signOut()` no longer changes the user, session or status.
  Before, a late answer could bring back a signed-out user, wipe or replace a
  new sign-in, or clear it.
- Sign-in, sign-up, magic-link verify, OAuth completions and `/logout` from one
  client run in call order. A sign-in answered after a newer `signOut()` or
  sign-in rejects with `AuthError` code `AUTH_SUPERSEDED` and changes nothing;
  the queued logout still runs after it. `getUser()` waits for queued calls and
  shares one `/me` per identity change.
- A `/me` 200 without a readable `user` now leaves the last-known user with
  status `'indeterminate'` instead of signing out. `{ user: null }` and 401 still
  sign out.
- `signOut()` still clears local state immediately and resolves. Clearing
  local state is not reported as a server sign-out: when `/logout` fails, times
  out or is refused, `signOutUnconfirmed` is true and `error.code` is
  `'SIGN_OUT_UNCONFIRMED'` until a later `signOut()` reaches the server (it
  retries, with the header session it was for), `/me` answers definitively,
  or a sign-in replaces the session. In cookie mode it also calls `/logout`
  when a sign-in is still queued.
- A sign-in that fails (refused, network, timeout) after it invalidated the
  first check re-checks `/me`, so the status does not stay `'checking'`. A
  failure that lands after a newer sign-in or sign-out changes nothing.
- Another tab signing in as someone else sets `'checking'` and re-checks `/me`
  instead of adopting that tab's cached user. Same-identity updates from other
  tabs are ignored, and an unchanged cached user is not rewritten.

Ordering covers one client instance. Other tabs, or a request the server
processes late, can still change the shared cookies; the next check reports it.

## 0.10.0 (2026-09-26) — The packaged sign-in handler never returns tokens unless asked

**Breaking (callers of `somewhereAuth` that read tokens from the response
without sending a mode header).**

### Changed
- **`somewhereAuth` answers a sign-in with the cookie session only, unless the
  caller explicitly asks for tokens.** Before, a request with no
  `X-Sw-Auth-Mode` header — for example a plain
  `fetch('/api/auth/login', { credentials: 'include' })` from a page — got the
  session cookie AND the access and refresh tokens in the response body, where
  any script on the page could read them. Now signup, login, magic-link verify
  and the Google/GitHub/Discord exchanges answer
  `{ user, cookie_session: true }` and set the httpOnly cookie. Only
  `X-Sw-Auth-Mode: header` (or `token`) returns the token pair, and then no
  cookie is set — that is for a server or native client that holds its own
  session.
- `createSomewhereAuth({ mode: 'header' })` now sends `X-Sw-Auth-Mode: header`
  on sign-in, so header-mode clients keep receiving tokens from the packaged
  handler. A header-mode client older than 0.10.0 sends no header and now gets
  the cookie answer instead: upgrade it together with the handler.
- A deploy whose runtime cannot set the session cookie answers
  `501 COOKIE_SESSION_UNAVAILABLE` instead of returning tokens. Redeploying
  picks up the current runtime.

## 0.9.0 (2026-09-26) — Cookie sign-in fails loudly; Subscribe and Manage billing work

**Breaking (browser sign-in against a handler without cookie mode).**

### Changed
- **A browser sign-in that the server doesn't confirm as a cookie session now
  throws instead of storing tokens.** `createSomewhereAuth()` in a browser (or
  with `mode: 'cookie'`) asks your `/api/auth` handler for a cookie session.
  When the handler does not reply `cookie_session: true`, `signIn`, `signUp`,
  `verifyMagicLink` and the OAuth completions now throw an `AuthError` with
  `code: 'COOKIE_SESSION_NOT_CONFIRMED'` and store nothing. The message names
  the fix: mount `somewhereAuth` from `@somewhere-tech/sdk/server`, or make
  your handler set the session cookies and reply
  `{ user, cookie_session: true }`. Before, the client quietly kept the
  returned token pair in `localStorage`, where page scripts can read it.
- `AuthError` has an optional `code`, set when the client itself refuses a
  response.

### Fixed
- **The `<PricingTable>` Subscribe button starts a checkout.** The packaged
  handler's `/billing/checkout` route called
  `sw.payments.checkoutForUser(userId, opts)`, but the runtime takes one
  `opts` argument and derives the buyer from the signed-in user, so every
  Subscribe click failed with `sw.payments.checkoutForUser: opts.plan is
  required`.
- **`<BillingPortal>` (Manage billing) opens the portal.** The same mismatch
  in `/billing/portal` dropped `return_url`, so every click failed with
  `return_url is required.`

### Notes for upgraders
- **Apps on the default starter or the packaged `somewhereAuth` handler see no
  change** — that handler already confirms cookie sessions.
- **A hand-written `/api/auth` handler that returns tokens must be updated**
  (or replaced with `somewhereAuth`) before upgrading. Scripts, CLIs and native
  clients that want tokens pass `mode: 'header'`, which is unchanged.
- A user already holding a stored token pair from a pre-0.2.0 install stays
  signed in; it moves to cookies on their next sign-in through a cookie-mode
  handler.

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
