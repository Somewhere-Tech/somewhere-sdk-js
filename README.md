# @somewhere-tech/sdk

Official JavaScript/TypeScript SDK for the [somewhere.tech](https://somewhere.tech) platform.

## The only authentication path

**Browser app → cookie session.** The browser calls same-origin app functions;
the server uses `sw.auth.*WithCookie` and `sw.auth.fromRequest`; credentials stay
in httpOnly cookies and page JavaScript holds zero tokens or developer keys.
Browser database and file work belongs in those server functions via `sw.db`
and `sw.fs`.

**Script, agent, CLI, server, or native app → bearer-token session.** These
environments have no browser cookie jar, so they use explicit bearer/refresh
rotation.

That is the whole map. This one package now contains both the Supabase-shaped
client and the optional cookie-native auth UI/handler adapter. Import only the
subpath you use; the modules are tree-shakeable. Header auth and direct browser
database/files calls are compatibility modes, not additional recommended
architectures. `@somewhere-tech/auth` remains only as a non-breaking re-export
shim for existing importers.

| Category | Style | Usage |
|---|---|---|
| Database | server/non-browser | `sw.db.query(...)` / `sw.from(...).select(...)` |
| Caching | automatic | on by default — dedup + ~1s cache + invalidate-on-write |
| Files | server/non-browser | `sw.fs.write(...)` / `sw.storage.from(...)` |
| Auth | Supabase Auth | `sw.auth.signInWithPassword({ email, password })` |
| Realtime | Supabase channels | `sw.channel('room').on('broadcast', { event }, fn).subscribe()` |
| Functions | Supabase invoke | `sw.functions.invoke('checkout', { body })` |
| Email | Resend | `sw.emails.send({ from, to, subject, html })` |
| AI | OpenAI | `sw.chat.completions.create({ model, messages })` |
| Payments | Stripe Connect | `sw.payments.checkout({ line_items, success_url })` |
| Tasks | per-project ticketing | `sw.tasks.create({ title, priority: 'high' })` |

## Install

```bash
npm install @somewhere-tech/sdk
```

One install, three focused entry points:

```typescript
import { createClient } from '@somewhere-tech/sdk';
import { createSomewhereAuth } from '@somewhere-tech/sdk/auth';
import { SomewhereAuthProvider, useAuth, SignedIn, SignedOut } from '@somewhere-tech/sdk/react';
import { somewhereAuth } from '@somewhere-tech/sdk/server';
```

## Migration from Supabase

Compatibility migration: change one import. `createClient` has the same signature, returns the same
`{ data, error }` envelope, and exposes `from`, `auth`, `storage`, `channel`,
and `functions`, so existing call sites can keep working while browser
database/files calls move behind same-origin server functions:

```typescript
// Before
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// After — only the import changes
import { createClient } from '@somewhere-tech/sdk';
const supabase = createClient(SOMEWHERE_URL, SOMEWHERE_KEY);

const { data, error } = await supabase.from('todos').select('*').eq('user_id', id);
await supabase.auth.signInWithPassword({ email, password });
supabase.storage.from('avatars').getPublicUrl('me.png');
supabase.channel('room').on('broadcast', { event: 'msg' }, (m) => render(m.payload)).subscribe();
await supabase.functions.invoke('checkout', { body: { plan: 'pro' } });
```

- **`SOMEWHERE_URL`** is your project's URL — `https://<project>.somewhere.tech`.
  It's the `functions.invoke` host and how the client infers your project id.
  On a custom domain, pass `{ projectId }`: `createClient(url, key, { projectId: 'my-app' })`.
- **`SOMEWHERE_KEY`** is an app-user JWT for compatibility/non-browser use or a
  developer `smt_` key for server-only use. Never ship an `smt_` key to a
  browser. New browser apps do not hold either credential after sign-in.

### The drop-in shim (compatibility migration)

Point an existing `./supabase` module at somewhere so call sites keep working
during migration:

```typescript
// src/lib/supabase.ts
import { createClient } from '@somewhere-tech/sdk';

export const supabase = createClient(
  import.meta.env.VITE_SOMEWHERE_URL,  // https://my-app.somewhere.tech
  import.meta.env.VITE_SOMEWHERE_KEY,
);
```

Your app's `import { supabase } from './lib/supabase'` lines don't change.

> **Browser sign-in is cookie-mode by default (0.6.0):** in a browser,
> `auth.signInWithPassword` / `signUp` post to your app's own auth routes
> (`/api/auth/*` — the standard `sw.auth.loginWithCookie` backend handler,
> see [Auth modes](#auth-modes-explained)), and the session lives in
> httpOnly cookies. No token ever lands in JS or localStorage, wrong
> passwords come back as `{ error }` with the real message, and the server
> refreshes the session automatically. `functions.invoke` and `auth.getUser`
> use that cookie directly. Existing direct browser `from` / `storage` calls
> remain functional but emit a migration warning; move them into server
> functions using `sw.db` / `sw.fs`.

### Server-side / explicit form

`new Somewhere({ key, projectId })` is the same client with an explicit
constructor — use it server-side where you hold an `smt_` key:

```typescript
import { Somewhere } from '@somewhere-tech/sdk';
const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
const { data } = await sw.from('users').select('*');
```

## Database — `sw.from(table)`

Supabase-style PostgREST query builder. Thenable — the chain doesn't hit the network until you `await` it.

> **Browser compatibility warning:** these direct calls still execute, but the
> SDK warns once because new browser apps should call a same-origin server
> function that uses `sw.db`. The warning is informational; there is no removal
> or runtime block in this release.

```typescript
const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });

// Select
const { data, error } = await sw.from('bookings').select('*').eq('user_id', 42);
const { data } = await sw.from('bookings').select('id, name').order('created_at').limit(10);
const { data } = await sw.from('bookings').select('*').in('status', ['confirmed', 'pending']);
const { data } = await sw.from('users').select('*').eq('id', 1).single();

// Count — total matching rows (ignores limit/range), alongside the page:
const { data, count } = await sw.from('bookings').select('*', { count: 'exact' }).limit(20);
// Just the count, no rows fetched:
const { count } = await sw.from('bookings').select('*', { count: 'exact', head: true }).eq('confirmed', 1);

// Nested foreign-key select — embed related rows (Supabase syntax):
const { data } = await sw.from('orders').select('*, customer(*)');     // belongs-to → object
const { data } = await sw.from('users').select('*, posts(id, title)'); // has-many → array
const { data } = await sw.from('orders').select('id, buyer:customer(name)'); // alias + narrowing

// Insert
const { data } = await sw.from('bookings').insert({ name: 'Alice', slot: '2026-05-01 18:00' });
const { data } = await sw.from('bookings').insert([
  { name: 'Bob', slot: '2026-05-01 19:00' },
  { name: 'Carol', slot: '2026-05-01 20:00' },
]);

// Update
const { data } = await sw.from('bookings').update({ confirmed: 1 }).eq('id', 42);

// Upsert
const { data } = await sw.from('users').upsert({ email: 'a@b.com', name: 'Alice' }, { onConflict: 'email' });

// Delete
const { data } = await sw.from('bookings').delete().eq('id', 42);
```

**Filters**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `match`, `or`.
**Modifiers**: `order`, `limit`, `range`, `single`, `maybeSingle`.
**Select options**: `select(cols, { count, head })` — `count: 'exact'` returns the total rows matching the filters (ignoring `limit`/`range`); add `head: true` to fetch the count without the rows.

**Nested selects** embed related rows by convention: `table(cols)` (or `alias:table(cols)`). A `<table>_id` column on the base row resolves a *belongs-to* relation (attached as an object); otherwise it's treated as *has-many* via a `<base-singular>_id` column on the child (attached as an array). `single()` / `maybeSingle()` errors are surfaced through `error` with code `PGRST116`.

```typescript
// OR a set of conditions (Supabase syntax), AND-ed with the rest:
const { data } = await sw
  .from('todos')
  .select('*')
  .or('status.eq.active,priority.gt.3')
  .eq('user_id', id);
```

Every query returns `{ data, error, count, status }`. `error` is `null` on success, `data` is `null` on error.

## Caching — fast by default

> **New in 0.5.0.** `from().select()` is cached automatically. Your app gets
> faster with zero code — no React Query, no SWR, no manual cache layer. The
> platform does it. See [docs/platform-intelligence.md](docs/platform-intelligence.md)
> for the why.

Three behaviours, all on by default, scoped to the client instance (so they're
auth-scoped for free — one `createClient` = one identity = one cache):

1. **Request dedup.** Two awaits of the same query while the first is still in
   flight share **one** network request. Render the same list in three
   components on one tick → one fetch.
2. **~1s staleTime cache.** A repeat read within ~1 second returns the prior
   result instead of refetching. The 1s window is deliberately short: normal
   polling (>1s apart) stays fresh, only sub-second bursts coalesce.
3. **Invalidate-on-write.** After an `insert`/`upsert`/`update`/`delete` on a
   table, that table's cached reads are dropped — so the next read is fresh.
   Read-your-own-writes stays correct.

```typescript
// Both calls fire on the same tick → ONE network request (dedup):
const [a, b] = await Promise.all([
  sw.from('todos').select('*').eq('done', false),
  sw.from('todos').select('*').eq('done', false),
]);

// Read-your-own-writes: the write invalidates 'todos', so this read is fresh:
await sw.from('todos').insert({ title: 'ship it' });
const { data } = await sw.from('todos').select('*'); // hits the network
```

The cache key is `project + table + columns + filters + order + limit/offset +
resolveType` — different filters are different entries; identical queries share.

### Prefetch — warm the cache ahead of need

```typescript
// On hover, warm the detail query; the click is then an instant cache hit:
onHover(() => sw.prefetch(sw.from('posts').select('*').eq('id', postId)));
onClick(async () => {
  const { data } = await sw.from('posts').select('*').eq('id', postId); // cache hit
});
```

### Opting out

```typescript
// Per-query: always hit the network for this one read (still warms the cache):
const { data } = await sw.from('rates').select('*').fresh();

// Globally: turn the whole cache off (pre-0.5.0 semantics — every read fetches):
const sw = createClient(SOMEWHERE_URL, SOMEWHERE_KEY, { cache: false });

// Tune the staleTime instead of disabling:
const sw = createClient(SOMEWHERE_URL, SOMEWHERE_KEY, { cache: { staleTime: 2000 } });
```

### Manual + realtime invalidation

`client.invalidate(table)` drops a table's cached reads by hand. This is also
the **seam for realtime-driven invalidation** — when realtime PG-change events
land, a handler can call it to auto-refresh anything that table feeds:

```typescript
// Roadmap shape (realtime → cache auto-invalidation, not wired in 0.5.0):
sw.channel('db:todos').on('postgres_changes', { event: '*' }, () => {
  sw.invalidate('todos'); // next read of todos is fresh
});
```

**Scope & limits.** Caching applies only to `from().select()` — raw
`sw.db.query(sql, params)` is never cached. The cache is in-memory and
per-client (no cross-tab/persistent storage) and resets when you create a new
client.

## Storage — `sw.storage.from(bucket)`

Supabase Storage bucket API. "Buckets" are name prefixes inside your project's file namespace — you never see raw paths.

> **Browser compatibility warning:** direct file calls still execute and warn
> once. New browser apps upload/read through a same-origin server function that
> uses `sw.fs`; public and signed URLs remain appropriate browser capabilities.

```typescript
const { data, error } = await sw.storage
  .from('avatars')
  .upload('user-42.png', file, { contentType: 'image/png' });

const { data } = await sw.storage.from('avatars').download('user-42.png');
// data.body is an ArrayBuffer, data.contentType is the stored content-type.

const { data } = await sw.storage.from('avatars').list('folder/');
const { data } = await sw.storage.from('avatars').remove(['user-42.png']);
const { data } = sw.storage.from('avatars').getPublicUrl('user-42.png');
// data.publicUrl is ready to drop into an <img src=...>.

// Time-limited link for a private file (Supabase-exact):
const { data } = await sw.storage.from('avatars').createSignedUrl('user-42.png', 3600);
// data.signedUrl is valid for 3600 seconds.
```

## Auth — `sw.auth`

The root SDK retains its Supabase-shaped `{ data, error }` envelope. The
tree-shakeable `@somewhere-tech/sdk/auth`, `/react`, and `/server` subpaths
provide the complete cookie-native adapter formerly implemented in the
standalone auth package:

- **Cookie mode (browser default):** sign-in goes through your app's own
  backend auth routes and the session is an httpOnly cookie — the SDK holds
  no tokens at all. `getSession()` returns `{ cookie_session: true, user }`
  (no readable tokens, by design). Requires the standard backend handler
  (`sw.auth.loginWithCookie` et al) mounted at `/api/auth` — see
  [Auth modes](#auth-modes-explained).
- **Header compatibility/non-browser mode (Node/CLI default, or `{ authMode: 'header' }`):** after a
  successful `signUp` or `signInWithPassword` the SDK automatically uses the
  returned JWT for every dual-auth call (db, storage, auth.me).
  Developer-only endpoints (email, AI) keep using the `smt_` key.

```typescript
const { data, error } = await sw.auth.signUp({ email, password });
const { data, error } = await sw.auth.signInWithPassword({ email, password });
const { data, error } = await sw.auth.signIn({ email, password }); // additive alias
await sw.auth.sendMagicLink({ email, redirectUri: '/after-login' });
await sw.auth.verifyMagicLink({ token });
const { data, error } = await sw.auth.signInWithOAuth({ provider: 'google' });
// data.url — redirect the browser there
const { data, error } = await sw.auth.signOut();

const { data: { user } } = await sw.auth.getUser();
const { data: { session } } = await sw.auth.getSession();

// React to sign-in / sign-out / token-refresh — same as Supabase
const { data: { subscription } } = sw.auth.onAuthStateChange((event, session) => {
  // event: 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
  if (event === 'SIGNED_OUT') redirectToLogin();
});
// later: subscription.unsubscribe();

// Header compatibility mode only: restore a caller-managed bearer session.
const fresh = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
await fresh.auth.setSession({ access_token: savedJwt });

// Update / reset password
await sw.auth.updateUser({ display_name: 'Alice' });
await sw.auth.resetPasswordForEmail('alice@example.com');
await sw.auth.verifyPasswordReset({ token: 'from-email', newPassword: '...' });
```

### One package, two source-compatible API shapes

| Intent | `@somewhere-tech/sdk/auth` | Root `@somewhere-tech/sdk` |
|---|---|---|
| Password sign-in | `signIn() → User` | `signInWithPassword()` or `signIn()` → `Result<AuthResponse>` |
| Start passwordless | `sendMagicLink() → void` | `sendMagicLink()` → `Result<{sent:true}>` |
| Complete passwordless | `verifyMagicLink() → User` | `verifyMagicLink()` → `Result<AuthResponse>` |
| Complete password reset | — | `verifyPasswordReset()` |
| Historical password-reset name | — | deprecated `verifyOtp()` alias, retained under rule 9 |

The transport and handler routes align; result envelopes remain intentionally
different for source compatibility. Existing `@somewhere-tech/auth` imports
resolve to the left-hand SDK subpaths through the standalone shim. See
[docs/auth-convergence.md](docs/auth-convergence.md) for the complete table and
the changes that require a major version or founder sign-off.

## Realtime — `sw.channel(name)`

Supabase channel API. `.on('broadcast', …)` listeners receive every message
published to the channel; `.send(…)` publishes one. Each `(project, channel)`
is an isolated stream.

```typescript
const channel = sw
  .channel('room-42')
  .on('broadcast', { event: 'message' }, ({ payload }) => {
    console.log('new message', payload);
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('listening');
  });

// Publish to everyone on the channel (including from the browser):
await channel.send({ type: 'broadcast', event: 'message', payload: { text: 'hi' } });

// Stop listening:
channel.unsubscribe();
```

`.subscribe()` opens a WebSocket and needs a `WebSocket` global (every browser;
Node ≥22, or inject one). Where it's absent it warns and the channel won't
*receive* — `.send()` (which uses REST) still delivers. `presence` and
`postgres_changes` listeners are accepted for source compatibility but are not
wired yet (roadmap).

## Functions — `sw.functions.invoke(name, options)`

Call one of your project's deployed `api/<name>` functions. `data` is the
function's JSON (or text) response; `error` is set on any non-2xx or network
failure.

```typescript
const { data, error } = await sw.functions.invoke('checkout', {
  body: { plan: 'pro' },          // JSON-encoded automatically
  // method: 'POST' (default), headers: { ... }
});
```

The function host is the `SOMEWHERE_URL` you passed to `createClient`
(`https://<project>.somewhere.tech` → `…/api/checkout`). With the explicit
`new Somewhere({ key, projectId })` form, the host is derived from a slug
`projectId`; a UUID `projectId` returns a loud `NO_FUNCTION_HOST` error telling
you to use `createClient(url, …)` or pass `functionsUrl`.

`sw.rpc(name, args)` is the Supabase `rpc()` alias — there are no SQL stored
procedures, so it calls your `api/<name>` function with `args` as the body:

```typescript
const { data, error } = await sw.rpc('compute_total', { user_id: id });
```

## Email — `sw.emails.send(...)`

Matches `resend.emails.send` exactly.

```typescript
const { data, error } = await sw.emails.send({
  from: 'noreply@myapp.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome</h1>',
  text: 'Welcome',
});
// data.id is the message ID.
```

## AI — `sw.chat.completions.create(...)`

Matches `openai.chat.completions.create` exactly — including the throw-on-error semantics (no `{data, error}` envelope here, because OpenAI doesn't use one).

```typescript
const completion = await sw.chat.completions.create({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Say hello in one word.' }],
  max_tokens: 32,
});
console.log(completion.choices[0].message.content);
console.log(completion.usage.total_tokens);
```

## Error handling

Every Supabase / Resend-style call returns `{ data, error }`. Branch on `.error`:

```typescript
const { data, error } = await sw.emails.send({ from, to, subject, text });
if (error) {
  console.error(error.code, error.message, error.statusCode);
  // retry on transient errors
  if (error.retry && error.retryAfterMs) {
    await new Promise((r) => setTimeout(r, error.retryAfterMs));
    // retry…
  }
}
```

`sw.chat.completions.create` throws instead of returning an envelope — catch it:

```typescript
import { SomewhereError } from '@somewhere-tech/sdk';

try {
  const completion = await sw.chat.completions.create({ model, messages });
} catch (err) {
  if (err instanceof SomewhereError) {
    console.error(err.code, err.statusCode);
  }
}
```

## Auth modes explained

There is one architecture with transport selected by environment:

```typescript
// Browser: no credential; the session cookie is managed by the browser.
const browser = createClient('https://booking-app.somewhere.tech');

// Server/non-browser: explicit bearer or developer credential.
const sw = new Somewhere({ key: 'smt_...' });
```

For browser apps, cookie mode is the default:

1. Mount the standard auth handler in your app's functions (one file —
   `sw.auth.loginWithCookie` / `signupWithCookie` / `logoutWithCookie` /
   `fromRequest`; `platform_help('auth-client')` has it verbatim) at
   `/api/auth/*`.
2. Browser calls `sw.auth.signInWithPassword({ email, password })` — the SDK
   posts to your route, the response sets httpOnly cookies, and every
   subsequent `functions.invoke` / `fetch(..., { credentials: 'include' })`
   carries the session automatically. No tokens in JS, nothing in
   localStorage, and the server refreshes the session in-band.

Non-browser clients without an httpOnly cookie jar pass
`{ authMode: 'header' }` and own bearer refresh/rotation. Existing browser
header sessions and older handlers keep working as a rule-9 compatibility
bridge and migrate on a later cookie sign-in; this is not a new-browser
recommendation.

## Test

```bash
SMT_KEY=smt_... npm test
```

## License

MIT © somewhere.tech
