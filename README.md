# @somewhere-tech/sdk

Official JavaScript and TypeScript client for [somewhere.tech](https://somewhere.tech).

For a browser application's database, start with the schema-generated client that the platform builds from `db/schema.ts`:

```ts
import { data } from 'somewhere:data'

const page = await data.notes.list({ limit: 20 })
await data.notes.create({ title: 'First note' })
await data.notes.update(noteId, { done: true })
await data.notes.remove(noteId)
```

The generated client exposes only the operations and fields declared in each table's `client` grant. Relations declared in the schema are available through generated `relations.<name>.list(...)` methods. Put product authorization and trusted database work in server functions with the runtime `sw.db` API.

Use `@somewhere-tech/sdk` when application code needs the maintained auth adapters, function invocation, or an explicit server/non-browser client for platform resources. The package keeps its established root exports and result shapes for existing applications, but it is not a replacement for the generated browser data client.

## Install

```bash
npm install @somewhere-tech/sdk
```

The package provides a root client and focused auth entry points:

```ts
import { createClient, Somewhere } from '@somewhere-tech/sdk'
import { createSomewhereAuth } from '@somewhere-tech/sdk/auth'
import { SomewhereAuthProvider, useAuth, SignedIn, SignedOut } from '@somewhere-tech/sdk/react'
import { somewhereAuth } from '@somewhere-tech/sdk/server'
```

## Browser auth and functions

Browser sessions use same-origin httpOnly cookies. Page JavaScript holds no developer key or session token. Mount the standard auth handler in your application at `/api/auth`, then create a credential-free browser client:

```ts
import { createClient } from '@somewhere-tech/sdk'

const client = createClient('https://booking-app.somewhere.tech')

const { data, error } = await client.auth.signInWithPassword({
  email: 'person@example.com',
  password,
})

const result = await client.functions.invoke('checkout', {
  body: { plan: 'pro' },
})
```

`functions.invoke(name, options)` calls `https://<project>.somewhere.tech/api/<name>`, includes browser cookies, and returns `{ data, error }`. On a custom domain, pass the project explicitly:

```ts
const client = createClient('https://app.example.com', undefined, {
  projectId: 'booking-app',
})
```

The auth client also provides signup, magic-link, OAuth, sign-out, password reset, user lookup, session lookup, and auth-state subscriptions. Cookie mode is the browser default. Non-browser clients can select `{ authMode: 'header' }` and manage bearer-session rotation explicitly.

## Server and non-browser client

Trusted server scripts can construct an explicit client with a developer key:

```ts
import { Somewhere } from '@somewhere-tech/sdk'

const client = new Somewhere({
  key: process.env.SOMEWHERE_API_KEY,
  projectId: 'booking-app',
})

const rows = await client.db.query(
  'SELECT id, total FROM orders WHERE status = ?',
  ['pending'],
)
```

Never expose an `smt_` developer key in browser code. Inside a deployed somewhere.tech function, use the supplied runtime instead of constructing an SDK client:

```ts
export default async function (request, sw) {
  const result = await sw.db.from('orders', {
    where: { status: 'pending' },
    limit: 20,
  })
  return Response.json(result.data)
}
```

The explicit client retains these established namespaces:

- `db` and `from(table)` for server/non-browser database access
- `fs` and `storage.from(prefix)` for server/non-browser files
- `auth` for user sessions and account actions
- `functions.invoke(name, options)` for application functions
- `realtime` and `channel(name)` for broadcast channels
- `emails`, `inbox`, `chat`, `payments`, `video`, `calls`, `tasks`, and `projects`

## Fluent database client

`client.from(table)` is a thenable fluent query builder for existing server and non-browser integrations. It supports filters such as `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `match`, and `or`, plus `order`, `limit`, `range`, `single`, and `maybeSingle`.

```ts
const { data, error } = await client
  .from('orders')
  .select('id, total, status')
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
  .limit(20)
```

Writes return the same `{ data, error, count?, status? }` result envelope:

```ts
await client.from('orders').insert({ id: 'order-1', status: 'pending' })
await client.from('orders').update({ status: 'paid' }).eq('id', 'order-1')
await client.from('orders').delete().eq('id', 'order-1')
```

`from().select()` uses a short per-client cache with request deduplication and write invalidation. Disable it with `{ cache: false }`, tune it with `{ cache: { staleTime: 2000 } }`, force one fresh read with `.fresh()`, or invalidate a table with `client.invalidate(table)`.

Direct database and private-file calls from a cookie-only browser client do not have a bearer credential. Use `somewhere:data` for declared browser database operations and same-origin functions for trusted logic.

## Files

The explicit client offers direct file operations through `client.fs` and a prefix-oriented interface through `client.storage.from(prefix)`:

```ts
const avatars = client.storage.from('avatars')
await avatars.upload('user-42.png', bytes, { contentType: 'image/png' })
const downloaded = await avatars.download('user-42.png')
const listed = await avatars.list('team/')
const publicUrl = avatars.getPublicUrl('user-42.png')
const signed = await avatars.createSignedUrl('user-42.png', 3600)
```

Use a server/non-browser credential for private file reads and writes. Public and signed URLs can be consumed by browsers.

## Realtime

Broadcast channels use `client.channel(name)` or `client.realtime.channel(name)`:

```ts
const channel = client
  .channel('room-42')
  .on('broadcast', { event: 'message' }, ({ payload }) => {
    console.log(payload)
  })
  .subscribe()

await channel.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'hello' },
})

channel.unsubscribe()
```

Receiving requires a `WebSocket` global. `presence` and `postgres_changes` listener names remain accepted by the existing API but are not active data-change subscriptions.

## Error handling

Most client calls return `{ data, error }`. Check `error` before using `data`:

```ts
const { data, error } = await client.functions.invoke('checkout', {
  body: { plan: 'pro' },
})

if (error) {
  console.error(error.code, error.message)
  if (error.retry && error.retryAfterMs) {
    // Retry only when the operation itself is safe to repeat.
  }
}
```

`client.chat.completions.create(...)` throws on failure and can be handled with `SomewhereError`.

## Test

```bash
npm test
```

## License

MIT © somewhere.tech
