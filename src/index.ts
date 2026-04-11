import { Client } from './client.js';
import { SomewhereError } from './errors.js';
import { AuthClient } from './resources/auth.js';
import { ChatClient } from './resources/chat.js';
import { EmailsClient } from './resources/emails.js';
import {
  PostgrestFilterBuilder,
  SomewhereQueryBuilder,
} from './resources/postgrest.js';
import { StorageClient, StorageFileApi } from './resources/storage.js';
import type { SomewhereOptions } from './types.js';

export { SomewhereError } from './errors.js';
export type { SomewhereErrorInit } from './errors.js';
export type * from './types.js';
export type { UploadOptions } from './resources/storage.js';
export { PostgrestFilterBuilder, SomewhereQueryBuilder } from './resources/postgrest.js';
export { StorageClient, StorageFileApi } from './resources/storage.js';
export { AuthClient } from './resources/auth.js';
export { EmailsClient } from './resources/emails.js';
export { ChatClient, ChatCompletionsClient } from './resources/chat.js';
export type { SomewhereOptions };

/**
 * The somewhere.tech client. Five namespaces matching the dominant
 * player in each category:
 *
 *   - `sw.from(table)` — Supabase-style PostgREST query builder
 *   - `sw.storage.from(bucket)` — Supabase Storage bucket API
 *   - `sw.auth` — Supabase Auth
 *   - `sw.emails.send(...)` — Resend email
 *   - `sw.chat.completions.create(...)` — OpenAI chat completions
 *
 * Migration from Supabase is one import and one constructor; every
 * other line stays the same.
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
  readonly storage: StorageClient;
  readonly emails: EmailsClient;
  readonly chat: ChatClient;

  private readonly client: Client;

  constructor(opts: SomewhereOptions) {
    this.client = new Client(opts);
    this.auth = new AuthClient(this.client);
    this.storage = new StorageClient(this.client);
    this.emails = new EmailsClient(this.client);
    this.chat = new ChatClient(this.client);
  }

  /** Supabase-style query builder entry point. */
  from(table: string): SomewhereQueryBuilder {
    return new SomewhereQueryBuilder(this.client, table);
  }
}

export default Somewhere;
