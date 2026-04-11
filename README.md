# @somewhere-tech/sdk

Official JavaScript/TypeScript SDK for the [somewhere.tech](https://somewhere.tech) platform API.

Thin wrapper around the REST API at `https://api.somewhere.tech/v1`. Works in Node ≥ 18, Bun, Deno, Cloudflare Workers, and browsers.

## Install

```bash
npm install @somewhere-tech/sdk
```

## Quick start

```typescript
import { Somewhere, SomewhereError } from '@somewhere-tech/sdk';

const sw = new Somewhere({ key: process.env.SMT_KEY! });

// Create a project
const project = await sw.projects.create({ name: 'Booking App' });

// Run a migration
await sw.db.migrate(
  `CREATE TABLE bookings (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     slot TEXT NOT NULL,
     created_at TEXT DEFAULT (datetime('now'))
   );`,
  project.id,
);

// Insert a row
await sw.db.query(
  'INSERT INTO bookings (name, slot) VALUES (?, ?)',
  ['Alice', '2026-05-01 18:00'],
  project.id,
);

// Deploy the static frontend
await sw.deploy({
  projectId: project.id,
  files: {
    'index.html': '<h1>Book a table</h1>',
  },
});

console.log(`Live at https://${project.subdomain}.somewhere.tech`);
```

## Auth modes

**Developer mode** — full access. Holds the secret `smt_` API key. Use this server-side.

```typescript
const sw = new Somewhere({ key: 'smt_...' });
```

**App-user mode** — browser-safe. Holds a JWT issued by `/v1/auth/login`. Limited to `db`, `storage`, `fs`, and `auth.me` on one project.

```typescript
const sw = new Somewhere({
  token: localStorage.getItem('sw_token')!,
  projectId: 'booking-app',
});

const me = await sw.auth.me();
const { rows } = await sw.db.query('SELECT * FROM bookings WHERE email = ?', [me.user.email]);
```

**Default project** — pass `projectId` once in the constructor so you don't have to repeat it:

```typescript
const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' });
await sw.db.query('SELECT * FROM bookings'); // uses 'booking-app'
await sw.db.query('SELECT * FROM other', [], 'other-project'); // per-call override
```

## Error handling

Every API error becomes a typed `SomewhereError`:

```typescript
import { SomewhereError } from '@somewhere-tech/sdk';

try {
  await sw.email.send({ to: 'user@example.com', subject: 'Hi', text: 'Welcome' });
} catch (err) {
  if (err instanceof SomewhereError) {
    console.error(err.code);           // e.g. "QUOTA_EXCEEDED"
    console.error(err.message);        // human-readable
    console.error(err.statusCode);     // 429
    console.error(err.retry);          // true if client should retry
    console.error(err.retryAfterMs);   // ms to wait before retrying
  }
  throw err;
}
```

See the [full error code list](https://github.com/somewhere-tech/somewhere-tech/blob/master/AGENT.md#error-codes-youll-actually-hit) in `AGENT.md`.

## Custom base URL

```typescript
const sw = new Somewhere({
  key: 'smt_...',
  baseUrl: 'http://localhost:8787/v1', // pointing at a local wrangler dev
});
```

## Method reference

| Namespace | Methods |
|---|---|
| `sw.projects` | `create`, `list`, `get`, `delete`, `undeploy`, `archive`, `unarchive`, `rename`, `deploys` |
| `sw.deploy` | `deploy(...)` (callable), `deploy.status(projectId?)` |
| `sw.promote` | `promote(projectId?)` (callable), `promote.rollback(projectId?)` |
| `sw.db` | `query`, `migrate`, `tables`, `schema` |
| `sw.storage` | `put`, `get`, `delete`, `list` |
| `sw.fs` | `write`, `read`, `delete`, `move`, `copy`, `stat`, `versions`, `restore` |
| `sw.auth` | `signup`, `login`, `logout`, `me`, `forgot`, `reset`, `users`, `verifyEmail`, `requestVerification`, `deleteAccount`, `updateMe` |
| `sw.email` | `send` |
| `sw.ai` | `complete`, `embed`*, `image`*, `tts`*, `transcribe`* |
| `sw.jobs` | `create`, `status`, `list`, `cancel`, `progress` |
| `sw.cron` | `create`, `list`, `update`, `delete` |
| `sw.queue` | `push` |
| `sw.logs` | `write`, `read` |
| `sw.env` | `set`, `list`, `delete` |
| `sw.domains` | `add`, `verify`, `list`, `delete` |
| `sw.preview` | `invite`, `revoke`, `viewers` |
| `sw.feedback` | `submit`, `list` |
| `sw.billing` | `status`, `checkout`, `portal` |
| `sw.usage` | `get`, `summary` |

Methods marked `*` are stubs that mirror endpoints not yet implemented on the platform — calling them returns `UNSUPPORTED_FEATURE` until the underlying endpoints ship.

## Test

Set an API key and run:

```bash
SMT_KEY=smt_... npm test
```

This creates a temporary project, runs a migration, inserts and reads rows, deploys a static file, then deletes the project.

## License

MIT © somewhere.tech
