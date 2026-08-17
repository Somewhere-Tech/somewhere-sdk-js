import { Client } from './client.js';
import { SomewhereError } from './errors.js';
import { AuthClient } from './resources/auth.js';
import { CallsClient } from './resources/calls.js';
import { ChatClient } from './resources/chat.js';
import { DbClient } from './resources/db.js';
import { EmailsClient } from './resources/emails.js';
import { FsClient } from './resources/fs.js';
import { FunctionsClient } from './resources/functions.js';
import { InboxClient } from './resources/inbox.js';
import { PaymentsClient } from './resources/payments.js';
import {
  PostgrestFilterBuilder,
  SomewhereQueryBuilder,
} from './resources/postgrest.js';
import type { Result } from './types.js';
import {
  RealtimeChannelClient,
  RealtimeClient,
} from './resources/realtime.js';
import { StorageClient, StorageFileApi } from './resources/storage.js';
import { TasksClient } from './resources/tasks.js';
import { ProjectsClient } from './resources/projects.js';
import { VideoClient } from './resources/video.js';
import type { CreateClientOptions, SomewhereOptions } from './types.js';

export { SomewhereError } from './errors.js';
export type { SomewhereErrorInit } from './errors.js';
export type * from './types.js';
export type { UploadOptions } from './resources/storage.js';
export { PostgrestFilterBuilder, SomewhereQueryBuilder } from './resources/postgrest.js';
export type { CountMode } from './resources/postgrest.js';
export { QueryCache } from './query-cache.js';
export type { CacheOptions } from './query-cache.js';
export { StorageClient, StorageFileApi } from './resources/storage.js';
export { AuthClient } from './resources/auth.js';
export { DbClient } from './resources/db.js';
export { EmailsClient } from './resources/emails.js';
export { FsClient } from './resources/fs.js';
export { FunctionsClient } from './resources/functions.js';
export { ChatClient, ChatCompletionsClient } from './resources/chat.js';
export { PaymentsClient } from './resources/payments.js';
export {
  RealtimeClient,
  RealtimeChannelClient,
  dispatchRealtimeFrame,
} from './resources/realtime.js';
export type { ChannelStatus } from './resources/realtime.js';
export { VideoClient } from './resources/video.js';
export { InboxClient, InboxAddressesClient, InboxMessagesClient } from './resources/inbox.js';
export { CallsClient } from './resources/calls.js';
export { TasksClient } from './resources/tasks.js';
export type { Task, CreateTaskInput, UpdateTaskInput, TaskListOptions } from './resources/tasks.js';
export { ProjectsClient } from './resources/projects.js';
export type { ProjectAllowedOrigins } from './resources/projects.js';
export type { SomewhereOptions };

/**
 * The somewhere.tech client. Namespaces match the dominant player in
 * each category, so migrating from the existing best-of-breed services
 * is one import and one constructor:
 *
 *   - `sw.db.query(sql, params)`     — raw SQL
 *   - `sw.db.from(table)` / `sw.from(table)` — Supabase-style query builder
 *   - `sw.fs.read(path)` / `sw.fs.write(path, body)` — raw filesystem
 *   - `sw.storage.from(bucket)`      — Supabase Storage bucket API
 *   - `sw.auth`                      — Supabase Auth
 *   - `sw.realtime.channel(name)`    — Supabase realtime channels
 *   - `sw.emails.send(...)`          — Resend email
 *   - `sw.inbox.messages.list(...)`  — inbound email
 *   - `sw.chat.completions.create()` — OpenAI chat completions
 *   - `sw.payments.checkout(...)`    — Stripe Connect (zero platform fee)
 *   - `sw.video.createUploadUrl()`   — direct-upload video pipeline
 *   - `sw.calls.createSession()`     — WebRTC SFU sessions
 *   - `sw.tasks.create(...)`         — per-project ticketing
 *
 *     // Before
 *     import { createClient } from '@supabase/supabase-js'
 *     const supabase = createClient(url, anonKey)
 *
 *     // After
 *     import { Somewhere } from '@somewhere-tech/sdk'
 *     const sw = new Somewhere({ key: 'smt_...', projectId: 'booking-app' })
 *
 *     const { data } = await sw.from('users').select('*').eq('id', 1)
 */
export class Somewhere {
  readonly auth: AuthClient;
  readonly db: DbClient;
  readonly fs: FsClient;
  readonly storage: StorageClient;
  readonly emails: EmailsClient;
  readonly inbox: InboxClient;
  readonly chat: ChatClient;
  readonly payments: PaymentsClient;
  readonly realtime: RealtimeClient;
  readonly functions: FunctionsClient;
  readonly video: VideoClient;
  readonly calls: CallsClient;
  readonly tasks: TasksClient;
  readonly projects: ProjectsClient;

  private readonly client: Client;

  constructor(opts: SomewhereOptions) {
    this.client = new Client(opts);
    this.auth = new AuthClient(this.client);
    this.db = new DbClient(this.client);
    this.fs = new FsClient(this.client);
    this.storage = new StorageClient(this.client);
    this.emails = new EmailsClient(this.client);
    this.inbox = new InboxClient(this.client);
    this.chat = new ChatClient(this.client);
    this.payments = new PaymentsClient(this.client);
    this.realtime = new RealtimeClient(this.client);
    this.functions = new FunctionsClient(this.client);
    this.video = new VideoClient(this.client);
    this.calls = new CallsClient(this.client);
    this.tasks = new TasksClient(this.client);
    this.projects = new ProjectsClient(this.client);
  }

  /** Supabase-style query builder entry point. Alias of `sw.db.from(table)`. */
  from(table: string): SomewhereQueryBuilder {
    return new SomewhereQueryBuilder(this.client, table);
  }

  /**
   * Warm the client cache for a query ahead of need — hover-prefetch, route
   * preload, "load the next page while they read this one". Just runs the
   * query (populating the instance cache); a later identical `.select()`
   * within the staleTime window is then served instantly from cache.
   *
   *     sw.prefetch(sw.from('posts').select('*').eq('id', hoveredId))
   *     // …on click, this is a cache hit, no network round-trip:
   *     const { data } = await sw.from('posts').select('*').eq('id', hoveredId)
   *
   * No-op for cache effects when the client was created with `{ cache: false }`.
   */
  prefetch<T = unknown>(query: PromiseLike<Result<T>>): Promise<Result<T>> {
    return Promise.resolve(query);
  }

  /**
   * Drop cached `from().select()` reads for a table. Read-your-own-writes is
   * already automatic (writes self-invalidate); reach for this to invalidate
   * by hand — e.g. from a realtime event handler (the realtime-invalidation
   * seam: `sw.channel('db:posts').on(..., () => sw.invalidate('posts'))`).
   */
  invalidate(table: string): void {
    this.client.invalidateTable(table);
  }

  /**
   * Supabase-style realtime channel entry point. Alias of
   * `sw.realtime.channel(name)`:
   *
   *     sw.channel('room')
   *       .on('broadcast', { event: 'message' }, ({ payload }) => { ... })
   *       .subscribe()
   */
  channel(name: string, opts: { projectId?: string } = {}): RealtimeChannelClient {
    return this.realtime.channel(name, opts);
  }

  /**
   * Supabase-style `rpc(name, args)`. On somewhere there are no SQL stored
   * procedures — a "database function" is one of your deployed `api/<name>`
   * functions. `rpc('foo', args)` therefore calls `POST {projectUrl}/api/foo`
   * with `args` as the JSON body and returns `{ data, error }`. Identical to
   * `functions.invoke(name, { body: args })`; provided so Supabase `rpc(...)`
   * call sites port unchanged.
   */
  rpc<T = unknown>(name: string, args?: Record<string, unknown>) {
    return this.functions.invoke<T>(name, args === undefined ? {} : { body: args });
  }
}

export default Somewhere;

/* ─── createClient — Supabase-compatible factory ─────────────────────── */

/**
 * Derive the project id from a `*.somewhere.tech` URL's subdomain. Returns
 * `undefined` for custom domains / api hosts / bare hosts — the caller must
 * then pass `projectId` explicitly (we never guess a project from a custom
 * domain). The seam is loud: an unresolved project id surfaces as a clear
 * error on the first call that needs one.
 */
export function projectIdFromUrl(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (!host.endsWith('.somewhere.tech')) return undefined;
  const sub = host.slice(0, -'.somewhere.tech'.length);
  // `api.somewhere.tech`, `www.`, or a deeper path aren't project subdomains.
  if (!sub || sub.includes('.') || sub === 'api' || sub === 'www') return undefined;
  return sub;
}

/**
 * Supabase-compatible client factory. Mirrors `@supabase/supabase-js`:
 *
 *     import { createClient } from '@somewhere-tech/sdk'
 *     const supabase = createClient(SOMEWHERE_URL, SOMEWHERE_KEY)
 *
 *     const { data, error } = await supabase.from('todos').select('*').eq('user_id', id)
 *     await supabase.auth.signInWithPassword({ email, password })
 *     supabase.storage.from('avatars').getPublicUrl('me.png')
 *     supabase.channel('room').on('broadcast', { event: 'msg' }, fn).subscribe()
 *     await supabase.functions.invoke('checkout', { body: { plan: 'pro' } })
 *
 * - `somewhereUrl` — your project's URL (`https://<project>.somewhere.tech`).
 *   Used as the `functions.invoke` host and to infer the project id. For a
 *   custom domain, pass `{ projectId }` in the options.
 * - `somewhereKey` — omit in a browser cookie app. For non-browser/
 *   compatibility use, pass an app-user JWT or a developer `smt_` key
 *   (server-only). Detected by the `smt_` prefix.
 *
 * Database / auth / storage calls go to the platform REST base
 * (`https://api.somewhere.tech/v1`, override with `options.apiUrl`).
 */
export function createClient(
  somewhereUrl: string,
  somewhereKey?: string,
  options: CreateClientOptions = {},
): Somewhere {
  const projectId = options.projectId ?? projectIdFromUrl(somewhereUrl);
  const isDeveloperKey = somewhereKey?.startsWith('smt_') ?? false;
  const functionsUrl =
    options.functionsUrl ?? (isLikelyHttpUrl(somewhereUrl) ? somewhereUrl : undefined);

  return new Somewhere({
    ...(somewhereKey
      ? isDeveloperKey
        ? { key: somewhereKey }
        : { token: somewhereKey }
      : {}),
    projectId,
    baseUrl: options.apiUrl,
    functionsUrl,
    fetch: options.fetch,
    headers: options.headers,
    authMode: options.authMode,
    authPath: options.authPath,
    cache: options.cache,
  });
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
