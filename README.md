# @somewhere-tech/sdk

Official JavaScript/TypeScript SDK for the [somewhere.tech](https://somewhere.tech) platform.

One API shape per category. Match the dominant player exactly. No raw escape hatches.

| Category | Copied from | Usage |
|---|---|---|
| Database | Supabase | `sw.from('users').select('*').eq('id', 1)` |
| Storage | Supabase Storage | `sw.storage.from('avatars').upload('a.png', file)` |
| Auth | Supabase Auth | `sw.auth.signUp({ email, password })` |
| Email | Resend | `sw.emails.send({ from, to, subject, html })` |
| AI | OpenAI | `sw.chat.completions.create({ model, messages })` |

## Install

```bash
npm install @somewhere-tech/sdk
```

## Migration from Supabase

Literally one import and one constructor:

```typescript
// Before
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(url, anonKey);
const { data } = await supabase.from('users').select('*');

// After
import { Somewhere } from '@somewhere-tech/sdk';
const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
const { data } = await sw.from('users').select('*');
```

Every other line stays identical.

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

**Filters**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `match`.
**Modifiers**: `order`, `limit`, `range`, `single`, `maybeSingle`.

Every query returns `{ data, error, count, status }`. `error` is `null` on success, `data` is `null` on error.

## Storage — `sw.storage.from(bucket)`

Supabase Storage bucket API. "Buckets" are name prefixes inside your project's R2 bucket — you never see raw paths.

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

// Persist the session across reloads by calling setSession on a fresh client:
const fresh = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
await fresh.auth.setSession({ access_token: savedJwt });

// Update / reset password
await sw.auth.updateUser({ display_name: 'Alice' });
await sw.auth.resetPasswordForEmail('alice@example.com');
await sw.auth.verifyOtp({ token: 'from-email', newPassword: '...' });
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
