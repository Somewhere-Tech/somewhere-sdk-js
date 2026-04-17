import type { Client } from '../client.js';
import type {
  RealtimeBroadcastResponse,
  RealtimeMetaResponse,
  Result,
} from '../types.js';

/**
 * Supabase-style realtime channels. Each (project, channel) is its own
 * isolated stream — projects can't see each other's traffic.
 *
 *     const ch = sw.realtime.channel('orders')
 *     await ch.broadcast({ event: 'order.placed', orderId: 42 })
 *     const { data } = await ch.meta()  // { subscribers, last_message_at }
 *
 * For browser subscribers, open a WebSocket directly to:
 *
 *     wss://api.somewhere.tech/v1/realtime/ws
 *       ?project_id=...&channel=orders&token=smt_...
 *
 * (Helper coming in a follow-up release; the WS protocol is stable.)
 */
export class RealtimeChannelClient {
  constructor(
    private readonly client: Client,
    private readonly channelName: string,
    private readonly explicitProjectId?: string,
  ) {}

  /** The channel name this client targets. */
  get channel(): string {
    return this.channelName;
  }

  async broadcast(message: unknown, opts: { from?: string } = {}): Promise<Result<RealtimeBroadcastResponse>> {
    const project_id = this.client.requireProjectId(this.explicitProjectId, 'realtime.broadcast');
    return this.client.safeCall<RealtimeBroadcastResponse>(
      'POST',
      `/realtime/channels/${encodeURIComponent(this.channelName)}/broadcast`,
      {
        auth: 'developer',
        body: { project_id, message, from: opts.from },
      },
    );
  }

  async meta(): Promise<Result<RealtimeMetaResponse>> {
    const project_id = this.client.requireProjectId(this.explicitProjectId, 'realtime.meta');
    return this.client.safeCall<RealtimeMetaResponse>(
      'GET',
      `/realtime/channels/${encodeURIComponent(this.channelName)}/meta`,
      {
        auth: 'developer',
        query: { project_id },
      },
    );
  }
}

export class RealtimeClient {
  constructor(private readonly client: Client) {}

  /** Get a channel handle. Optionally override the project id. */
  channel(name: string, opts: { projectId?: string } = {}): RealtimeChannelClient {
    return new RealtimeChannelClient(this.client, name, opts.projectId);
  }
}
