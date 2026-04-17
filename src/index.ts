import { Client } from './client.js';
import { SomewhereError } from './errors.js';
import { AuthClient } from './resources/auth.js';
import { CallsClient } from './resources/calls.js';
import { ChatClient } from './resources/chat.js';
import { EmailsClient } from './resources/emails.js';
import { InboxClient } from './resources/inbox.js';
import { PaymentsClient } from './resources/payments.js';
import {
  PostgrestFilterBuilder,
  SomewhereQueryBuilder,
} from './resources/postgrest.js';
import { RealtimeClient } from './resources/realtime.js';
import { StorageClient, StorageFileApi } from './resources/storage.js';
import { VideoClient } from './resources/video.js';
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
export { PaymentsClient } from './resources/payments.js';
export { RealtimeClient, RealtimeChannelClient } from './resources/realtime.js';
export { VideoClient } from './resources/video.js';
export { InboxClient, InboxAddressesClient, InboxMessagesClient } from './resources/inbox.js';
export { CallsClient } from './resources/calls.js';
export type { SomewhereOptions };

/**
 * The somewhere.tech client. Namespaces match the dominant player in
 * each category, so migrating from the existing best-of-breed services
 * is one import and one constructor:
 *
 *   - `sw.from(table)`               — Supabase-style PostgREST query builder
 *   - `sw.storage.from(bucket)`      — Supabase Storage bucket API
 *   - `sw.auth`                      — Supabase Auth
 *   - `sw.realtime.channel(name)`    — Supabase realtime channels
 *   - `sw.emails.send(...)`          — Resend email
 *   - `sw.inbox.messages.list(...)`  — inbound email
 *   - `sw.chat.completions.create()` — OpenAI chat completions
 *   - `sw.payments.checkout(...)`    — Stripe Connect (5% platform fee)
 *   - `sw.video.createUploadUrl()`   — direct-upload video pipeline
 *   - `sw.calls.createSession()`     — WebRTC SFU sessions
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
  readonly inbox: InboxClient;
  readonly chat: ChatClient;
  readonly payments: PaymentsClient;
  readonly realtime: RealtimeClient;
  readonly video: VideoClient;
  readonly calls: CallsClient;

  private readonly client: Client;

  constructor(opts: SomewhereOptions) {
    this.client = new Client(opts);
    this.auth = new AuthClient(this.client);
    this.storage = new StorageClient(this.client);
    this.emails = new EmailsClient(this.client);
    this.inbox = new InboxClient(this.client);
    this.chat = new ChatClient(this.client);
    this.payments = new PaymentsClient(this.client);
    this.realtime = new RealtimeClient(this.client);
    this.video = new VideoClient(this.client);
    this.calls = new CallsClient(this.client);
  }

  /** Supabase-style query builder entry point. */
  from(table: string): SomewhereQueryBuilder {
    return new SomewhereQueryBuilder(this.client, table);
  }
}

export default Somewhere;
