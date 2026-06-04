import type { Client } from '../client.js';
import type {
  RealtimeBroadcastPayload,
  RealtimeBroadcastResponse,
  RealtimeMetaResponse,
  Result,
} from '../types.js';

/**
 * Supabase-style realtime channels. Each (project, channel) is its own
 * isolated stream — projects can't see each other's traffic.
 *
 * Browser subscribe (Supabase-compatible):
 *
 *     const channel = sw.channel('room')
 *       .on('broadcast', { event: 'message' }, ({ payload }) => render(payload))
 *       .subscribe()
 *
 *     await channel.send({ type: 'broadcast', event: 'message', payload: { text: 'hi' } })
 *     channel.unsubscribe()
 *
 * Server-side fan-out (from a deployed function or your backend):
 *
 *     const ch = sw.realtime.channel('orders')
 *     await ch.broadcast({ orderId: 42 })       // legacy { message } shape
 *     await ch.send({ type: 'broadcast', event: 'order.placed', payload: { id: 42 } })
 *     const { data } = await ch.meta()          // { subscribers, last_message_at }
 *
 * `.on()`/`.subscribe()` need a `WebSocket` global (every browser; Node ≥22,
 * or inject one). Where it's absent, `.subscribe()` warns loudly and the
 * channel simply won't *receive* — `.send()` (which goes over REST) still
 * delivers to other subscribers.
 */

type BroadcastListener = (payload: RealtimeBroadcastPayload) => void;

interface Registration {
  /** Event name to match, or '*' for all. */
  filterEvent: string;
  handler: BroadcastListener;
}

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED';

export class RealtimeChannelClient {
  private socket: WebSocket | null = null;
  private readonly registrations: Registration[] = [];
  private statusCb: ((status: ChannelStatus) => void) | null = null;

  constructor(
    private readonly client: Client,
    private readonly channelName: string,
    private readonly explicitProjectId?: string,
  ) {}

  /** The channel name this client targets. */
  get channel(): string {
    return this.channelName;
  }

  /* ─── Subscribe surface (Supabase-compatible) ───────────────────── */

  /**
   * Register a listener. Only `'broadcast'` is wired today; `'presence'`
   * and `'postgres_changes'` are roadmap (calling them is a no-op that
   * keeps the chain valid so migrated code doesn't throw).
   */
  on(
    type: 'broadcast',
    filter: { event: string },
    handler: BroadcastListener,
  ): this {
    if (type === 'broadcast') {
      this.registrations.push({ filterEvent: filter?.event ?? '*', handler });
    }
    return this;
  }

  /** Open the realtime WebSocket and dispatch incoming frames to `.on()` listeners. */
  subscribe(statusCb?: (status: ChannelStatus) => void): this {
    this.statusCb = statusCb ?? null;

    if (typeof WebSocket === 'undefined') {
      // Loud seam: no WebSocket in this runtime. Receiving won't work, but
      // .send() (REST publish) still delivers to other subscribers.
      // eslint-disable-next-line no-console
      console.warn(
        "[somewhere] channel.subscribe() needs a WebSocket global (browser, " +
          'Node ≥22, or inject one). This channel will not RECEIVE messages; ' +
          'channel.send(...) still delivers to other subscribers.',
      );
      this.statusCb?.('CHANNEL_ERROR');
      return this;
    }

    const projectId = this.client.requireProjectId(this.explicitProjectId, 'channel.subscribe');
    const token = this.client.realtimeToken;
    const url =
      `${this.client.wsBaseUrl}/realtime/subscribe` +
      `?project_id=${encodeURIComponent(projectId)}` +
      `&channel=${encodeURIComponent(this.channelName)}` +
      `&token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.addEventListener('open', () => this.statusCb?.('SUBSCRIBED'));
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        let frame: unknown;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return;
        }
        dispatchRealtimeFrame(frame, this.registrations);
      });
      ws.addEventListener('close', () => this.statusCb?.('CLOSED'));
      ws.addEventListener('error', () => this.statusCb?.('CHANNEL_ERROR'));
    } catch {
      this.statusCb?.('CHANNEL_ERROR');
    }
    return this;
  }

  /**
   * Send a broadcast. Routes through the canonical publish endpoint so every
   * subscriber receives a typed `event` frame (matching `.on('broadcast',
   * { event })`). Returns `'ok'` or `'error'` (Supabase returns a status
   * string from `send`).
   */
  async send(message: {
    type: 'broadcast';
    event: string;
    payload: unknown;
  }): Promise<'ok' | 'error'> {
    const project_id = this.client.requireProjectId(this.explicitProjectId, 'channel.send');
    const res = await this.client.safeCall('POST', '/realtime/publish', {
      auth: 'dual',
      body: {
        project_id,
        channel: this.channelName,
        event: message.event,
        data: message.payload,
      },
    });
    return res.error ? 'error' : 'ok';
  }

  /** Close the WebSocket and drop all listeners. */
  unsubscribe(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* already closing */
      }
      this.socket = null;
    }
    this.registrations.length = 0;
  }

  /* ─── Server-side fan-out (existing surface, unchanged) ──────────── */

  async broadcast(
    message: unknown,
    opts: { from?: string } = {},
  ): Promise<Result<RealtimeBroadcastResponse>> {
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

/**
 * Pure frame → listener dispatch. Exported so the framing contract can be
 * unit-tested without a live socket. Returns the number of handlers fired.
 *
 * Server frames (durable-objects/realtime-channel.ts):
 *   - canonical publish → `{ type: 'event', event, data, from, at }`
 *   - legacy/peer       → `{ type: 'message', message, from, at }`
 */
export function dispatchRealtimeFrame(
  frame: unknown,
  registrations: Array<{ filterEvent: string; handler: BroadcastListener }>,
): number {
  if (!frame || typeof frame !== 'object') return 0;
  const f = frame as { type?: string; event?: string; data?: unknown; message?: unknown };
  let fired = 0;

  if (f.type === 'event') {
    const event = typeof f.event === 'string' ? f.event : 'message';
    for (const r of registrations) {
      if (r.filterEvent === '*' || r.filterEvent === event) {
        r.handler({ type: 'broadcast', event, payload: f.data });
        fired++;
      }
    }
  } else if (f.type === 'message') {
    for (const r of registrations) {
      if (r.filterEvent === '*' || r.filterEvent === 'message') {
        r.handler({ type: 'broadcast', event: 'message', payload: f.message });
        fired++;
      }
    }
  }

  return fired;
}
