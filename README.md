# @somewhere-tech/sdk

Official JavaScript/TypeScript SDK for the [somewhere.tech](https://somewhere.tech) platform.

One API shape per category. Match the dominant player exactly. No raw escape hatches.

| Category | Style | Usage |
|---|---|---|
| Database | raw SQL | `sw.db.query('SELECT * FROM users WHERE id = $1', [id])` |
| Database | Supabase | `sw.from('users').select('*').eq('id', 1)` |
| Files | path-based | `sw.fs.write('avatar.png', bytes)` / `sw.fs.read(path)` |
| Storage | Supabase Storage | `sw.storage.from('avatars').upload('a.png', file)` |
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

## Migration from Supabase

Change one import. `createClient` has the same signature, returns the same
`{ data, error }` envelope, and exposes `from`, `auth`, `storage`, `channel`,
and `functions` — so most call sites don't change at all:

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
- **`SOMEWHERE_KEY`** is an app-user JWT (browser) or a developer `smt_` key
  (server-only — never ship it to the browser). The `smt_` prefix is detected
  automatically.

### The drop-in shim (recommended migration path)

Point your existing `./supabase` module at somewhere and **every call site keeps
working unchanged**:

```typescript
// src/lib/supabase.ts
import { createClient } from '@somewhere-tech/sdk';

export const supabase = createClient(
  import.meta.env.VITE_SOMEWHERE_URL,  // https://my-app.somewhere.tech
  import.meta.env.VITE_SOMEWHERE_KEY,
);
```

Your app's `import { supabase } from './lib/supabase'` lines don't change.

> **One seam to know about:** `auth.signInWithPassword` / `signUp` are
> developer-gated on the platform, so from the browser (a JWT key) they return
> a clear `INVALID_API_KEY` rather than logging in directly. Run them through a
> tiny backend endpoint you host (see [Auth modes](#auth-modes-explained)), or
> use [`@somewhere-tech/auth`](https://www.npmjs.com/package/@somewhere-tech/auth)
> which ships that endpoint for you. Everything else — `from`, `storage`,
> `channel`, `functions`, `auth.getUser` — works directly from the browser.

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

```typescript
const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });

// Select
const { data, error } = await sw.from('bookings').select('*').eq('user_id', 42);
const { data } = await sw.from('bookings').select('id, name').order('created_at').limit(10);
const { data } = await sw.from('bookings').select('*').in('status', ['confirmed', 'pending']);
const { data } = await sw.from('users').select('*').eq('id', 1).single();

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

```typescript
// OR a set of conditions (Supabase syntax), AND-ed with the rest:
const { data } = await sw
  .from('todos')
  .select('*')
  .or('status.eq.active,priority.gt.3')
  .eq('user_id', id);
```

Every query returns `{ data, error, count, status }`. `error` is `null` on success, `data` is `null` on error.

## Storage — `sw.storage.from(bucket)`

Supabase Storage bucket API. "Buckets" are name prefixes inside your project's file namespace — you never see raw paths.

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

Supabase Auth method names. After a successful `signUp` or `signInWithPassword` the SDK automatically uses the returned JWT for every dual-auth call (db, storage, auth.me). Developer-only endpoints (email, AI) keep using the `smt_` key.

```typescript
const { data, error } = await sw.auth.signUp({ email, password });
const { data, error } = await sw.auth.signInWithPassword({ email, password });
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

// Persist the session across reloads by calling setSession on a fresh client:
const fresh = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
await fresh.auth.setSession({ access_token: savedJwt });

// Update / reset password
await sw.auth.updateUser({ display_name: 'Alice' });
await sw.auth.resetPasswordForEmail('alice@example.com');
await sw.auth.verifyOtp({ token: 'from-email', newPassword: '...' });
```

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

The SDK supports two construction modes that match the two Somewhere auth flows:

```typescript
// Server-side (full access — never ship to the browser)
const sw = new Somewhere({ key: 'smt_...' });

// Client-side (user JWT, scoped to one project)
const sw = new Somewhere({ token: 'eyJ...', projectId: 'booking-app' });
```

When the server-side client successfully signs a user in, it automatically scopes its dual-auth calls (db, storage, auth.me) to the user's JWT while keeping developer-only calls (email, AI, auth.signUp) using the `smt_` key. This matches Supabase's behavior.

For SPA patterns, the recommended flow is:

1. Browser calls a BFF endpoint you host.
2. BFF calls `sw.auth.signInWithPassword(...)` with the `smt_` key and returns the resulting `session.access_token` to the browser.
3. Browser constructs its own `new Somewhere({ token, projectId })` and makes direct calls from there.

## Test

```bash
SMT_KEY=smt_... npm test
```

## License

MIT © somewhere.tech
