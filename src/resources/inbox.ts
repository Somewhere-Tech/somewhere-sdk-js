import type { Client } from '../client.js';
import type {
  InboxAddress,
  InboxAddressCreateRequest,
  InboxAddressListResponse,
  InboxListOptions,
  InboxMessageDetail,
  InboxMessageListResponse,
  Result,
} from '../types.js';

/**
 * Inbound email — the receive side of `sw.emails.send(...)`.
 * Each project can mint addresses on the platform's inbox subdomain,
 * and incoming mail is persisted with subject + text preview + raw MIME.
 *
 *     // Create an inbox address (e.g. orders@inbox.somewhere.tech).
 *     await sw.inbox.addresses.create({ local: 'orders', label: 'Orders' })
 *
 *     // List recent messages.
 *     const { data } = await sw.inbox.messages.list({ limit: 20 })
 *
 *     // Fetch the full message + a path for the raw .eml.
 *     const msg = await sw.inbox.messages.get('msg-id')
 *
 *     // Raw MIME bytes (forwarding, archival, parsing).
 *     const raw = await sw.inbox.messages.getRaw('msg-id')
 */
export class InboxAddressesClient {
  constructor(private readonly client: Client) {}

  async create(input: InboxAddressCreateRequest): Promise<Result<InboxAddress>> {
    const project_id = this.client.requireProjectId(input.projectId, 'inbox.addresses.create');
    return this.client.safeCall<InboxAddress>('POST', '/inbox/addresses', {
      auth: 'developer',
      body: { project_id, local: input.local, label: input.label },
    });
  }

  async list(opts: { projectId?: string } = {}): Promise<Result<InboxAddressListResponse>> {
    const project_id = this.client.requireProjectId(opts.projectId, 'inbox.addresses.list');
    return this.client.safeCall<InboxAddressListResponse>('GET', '/inbox/addresses', {
      auth: 'developer',
      query: { project_id },
    });
  }

  async delete(id: string): Promise<Result<{ id: string; deleted: true }>> {
    return this.client.safeCall<{ id: string; deleted: true }>(
      'DELETE',
      `/inbox/addresses/${encodeURIComponent(id)}`,
      { auth: 'developer' },
    );
  }
}

export class InboxMessagesClient {
  constructor(private readonly client: Client) {}

  async list(opts: InboxListOptions = {}): Promise<Result<InboxMessageListResponse>> {
    const project_id = this.client.requireProjectId(opts.projectId, 'inbox.messages.list');
    return this.client.safeCall<InboxMessageListResponse>('GET', '/inbox', {
      auth: 'developer',
      query: { project_id, address_id: opts.addressId, limit: opts.limit },
    });
  }

  async get(id: string): Promise<Result<InboxMessageDetail>> {
    return this.client.safeCall<InboxMessageDetail>('GET', `/inbox/${encodeURIComponent(id)}`, {
      auth: 'developer',
    });
  }

  /** Raw MIME bytes (`.eml`) and content type. */
  async getRaw(id: string): Promise<{ body: ArrayBuffer; contentType: string }> {
    return this.client.getBytes(`/inbox/${encodeURIComponent(id)}/raw`, undefined, 'developer');
  }

  async delete(id: string): Promise<Result<{ id: string; deleted: true }>> {
    return this.client.safeCall<{ id: string; deleted: true }>(
      'DELETE',
      `/inbox/${encodeURIComponent(id)}`,
      { auth: 'developer' },
    );
  }
}

export class InboxClient {
  readonly addresses: InboxAddressesClient;
  readonly messages: InboxMessagesClient;

  constructor(client: Client) {
    this.addresses = new InboxAddressesClient(client);
    this.messages = new InboxMessagesClient(client);
  }
}
