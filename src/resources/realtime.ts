import type { Client } from '../client.js';
import type {
  RealtimeBroadcastPayload,
  RealtimeBroadcastResponse,
  RealtimeMetaResponse,
  Result,
  PresenceEvent,
  PresencePayload,
  RealtimePresenceState,
} from '../types.js';
import {
  backoffCeiling,
  jitter,
  buildSubscribeUrl,
  frameSeq,
  isControlFrame,
} from './realtime-reconnect.js';
import { applyPresenceFrame, isPresenceErrorFrame } from './realtime-presence.js';

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
 * Presence — who's online + their state (Supabase-compatible):
 *
 *     const room = sw.channel('room', { config: { presence: { key: userId } } })
 *       .on('presence', { event: 'sync' }, () => setOnline(room.presenceState()))
 *       .on('presence', { event: 'join' }, ({ newPresences }) => {})
 *       .on('presence', { event: 'leave' }, ({ leftPresences }) => {})
 *       .subscribe((status) => {
 *         if (status === 'SUBSCRIBED') room.track({ name, online_at: Date.now() })
 *       })
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
 *
 * Resilience (tsk_e70c3713): `.subscribe()` AUTO-RECONNECTS with exponential
 * backoff + jitter and re-subscribes the same channel when the socket drops
 * (flaky mobile). It tracks the last message `seq` and resumes with
 * `?since=<seq>`, so the server replays messages missed during the gap.
 * `.unsubscribe()` is the only thing that stops reconnection.
 */

type BroadcastListener = (payload: RealtimeBroadcastPayload) => void;
type PresenceListener = (payload: PresencePayload) => void;

interface Registration {
  /** Event name to match, or '*' for all. */
  filterEvent: string;
  handler: BroadcastListener;
}

interface PresenceRegistration {
  event: PresenceEvent;
  handler: PresenceListener;
}

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED';

export class RealtimeChannelClient {
  private socket: WebSocket | null = null;
  private readonly registrations: Registration[] = [];
  private readonly presenceRegistrations: PresenceRegistration[] = [];
  /** Current presence members, grouped by key — what presenceState() returns. */
  private presenceMap: RealtimePresenceState = {};
  /** Last state passed to track(); re-sent on every (re)connect. undefined = not tracking. */
  private trackedState: unknown = undefined;
  private isTracking = false;
  private statusCb: ((status: ChannelStatus) => void) | null = null;
  /** Highest message seq seen — the resume cursor sent on reconnect. */
  private lastSeq: number | null = null;
  /** Consecutive reconnect attempts (drives backoff); reset on a clean open. */
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by unsubscribe() — the one signal that suppresses auto-reconnect. */
  private intentionallyClosed = false;

  constructor(
    private readonly client: Client,
    private readonly channelName: string,
    private readonly explicitProjectId?: string,
    /** Supabase `config.presence.key` — the grouping key for this client's presence. */
    private readonly presenceKey?: string,
  ) {}

  /** The channel name this client targets. */
  get channel(): string {
    return this.channelName;
  }

  /* ─── Subscribe surface (Supabase-compatible) ───────────────────── */

  /**
   * Register a listener (Supabase-compatible). `'broadcast'` dispatches
   * published events; `'presence'` dispatches the `sync` / `join` / `leave`
   * lifecycle — read the current members with `presenceState()`. (`'postgres_changes'`
   * is still roadmap — a no-op that keeps the chain valid.)
   */
  on(type: 'broadcast', filter: { event: string }, handler: BroadcastListener): this;
  on(type: 'presence', filter: { event: PresenceEvent }, handler: PresenceListener): this;
  on(
    type: 'broadcast' | 'presence',
    filter: { event: string },
    handler: BroadcastListener | PresenceListener,
  ): this {
    if (type === 'broadcast') {
      this.registrations.push({ filterEvent: filter?.event ?? '*', handler: handler as BroadcastListener });
    } else if (type === 'presence') {
      this.presenceRegistrations.push({
        event: (filter?.event ?? 'sync') as PresenceEvent,
        handler: handler as PresenceListener,
      });
    }
    return this;
  }

  /**
   * Open the realtime WebSocket and dispatch incoming frames to `.on()`
   * listeners. Auto-reconnects with backoff (resuming via `?since`) until
   * `.unsubscribe()` is called.
   */
  subscribe(statusCb?: (status: ChannelStatus) => void): this {
    this.statusCb = statusCb ?? null;
    this.intentionallyClosed = false;

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

    this.openSocket();
    return this;
  }

  /** Open (or re-open) the socket for this channel, resuming from lastSeq. */
  private openSocket(): void {
    const projectId = this.client.requireProjectId(this.explicitProjectId, 'channel.subscribe');
    const token = this.client.realtimeToken;
    const url = buildSubscribeUrl({
      wsBaseUrl: this.client.wsBaseUrl,
      projectId,
      channel: this.channelName,
      token,
      since: this.lastSeq,
    });

    try {
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.addEventListener('open', () => {
        if (this.socket !== ws) return; // superseded by a newer socket
        this.reconnectAttempts = 0; // clean connection — reset backoff
        // Re-establish presence after a reconnect so members don't vanish on a
        // flaky connection (the server cleared it when the old socket dropped).
        if (this.isTracking) this.sendTrack();
        this.statusCb?.('SUBSCRIBED');
      });
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (this.socket !== ws) return;
        if (typeof ev.data !== 'string') return;
        let frame: unknown;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return;
        }
        const seq = frameSeq(frame);
        if (seq !== null) this.lastSeq = seq; // advance the resume cursor
        if (isControlFrame(frame)) {
          this.handleControlFrame(frame);
          return;
        }
        dispatchRealtimeFrame(frame, this.registrations);
      });
      ws.addEventListener('close', () => {
        if (this.socket !== ws) return;
        this.statusCb?.('CLOSED');
        this.scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        if (this.socket !== ws) return;
        this.statusCb?.('CHANNEL_ERROR');
        // A close event usually follows and drives the reconnect; if the
        // runtime fires error WITHOUT close, schedule here too (idempotent).
        this.scheduleReconnect();
      });
    } catch {
      this.statusCb?.('CHANNEL_ERROR');
      this.scheduleReconnect();
    }
  }

  /** Schedule one backoff-delayed reconnect (no-op if already pending/closed). */
  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer) return;
    const delay = jitter(backoffCeiling(this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionallyClosed) return;
      this.openSocket();
    }, delay);
  }

  /** Handle platform control frames (not delivered to broadcast listeners). */
  private handleControlFrame(frame: unknown): void {
    // Presence frames (sync/join/leave) fold into presenceState() and fire
    // `.on('presence', ...)` listeners.
    const presence = applyPresenceFrame(this.presenceMap, frame);
    if (presence) {
      this.presenceMap = presence.state;
      this.dispatchPresence(presence.payload);
      return;
    }
    if (isPresenceErrorFrame(frame)) {
      // Fail loud: the server rejected our track() (e.g. an oversized state blob).
      // eslint-disable-next-line no-console
      console.warn(
        `[somewhere] channel "${this.channelName}" presence error: ` +
          `${(frame as { error?: string }).error ?? 'unknown'}. ` +
          ((frame as { message?: string }).message ?? ''),
      );
      return;
    }
    const f = frame as { type?: string; gap?: boolean; missed_from?: number; missed_to?: number };
    if (f.type === 'sw_resume' && f.gap) {
      // Fail loud: the server couldn't replay everything we missed (the
      // gap fell outside its rewind window). Surface it so the app can
      // refetch state rather than silently believing it's caught up.
      // eslint-disable-next-line no-console
      console.warn(
        `[somewhere] channel "${this.channelName}" resumed with a gap: messages ` +
          `${f.missed_from}–${f.missed_to} were beyond the replay window and ` +
          'were not redelivered. Refetch state if you need them.',
      );
    }
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

  /* ─── Presence (Supabase-compatible) ────────────────────────────── */

  /**
   * The current presence members, grouped by key:
   * `{ [key]: [{ presence_ref, ...trackedState }] }`. Read this from a
   * `.on('presence', { event: 'sync' }, ...)` handler.
   */
  presenceState(): RealtimePresenceState {
    const out: RealtimePresenceState = {};
    for (const k of Object.keys(this.presenceMap)) out[k] = this.presenceMap[k].slice();
    return out;
  }

  /**
   * Announce this client's presence (who you are + arbitrary state) on the
   * channel. Other subscribers receive a `join`; everyone (including you) gets
   * a fresh `sync`. The state is re-sent automatically after a reconnect.
   * Requires an open socket — call it once `.subscribe()` reports `SUBSCRIBED`.
   */
  track(state: unknown): 'ok' | 'error' {
    this.trackedState = state;
    this.isTracking = true;
    return this.sendTrack();
  }

  /** Stop announcing presence on the channel — other subscribers get a `leave`. */
  untrack(): 'ok' | 'error' {
    this.isTracking = false;
    this.trackedState = undefined;
    return this.sendControl({ type: 'sw_presence_untrack' });
  }

  /** Send the current tracked state over the socket (used by track() + on reconnect). */
  private sendTrack(): 'ok' | 'error' {
    return this.sendControl({
      type: 'sw_presence_track',
      state: this.trackedState,
      ...(this.presenceKey ? { key: this.presenceKey } : {}),
    });
  }

  /** Send a presence control frame over the socket. 'error' if no socket is open. */
  private sendControl(frame: object): 'ok' | 'error' {
    if (!this.socket) return 'error';
    try {
      this.socket.send(JSON.stringify(frame));
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Fire the `.on('presence', { event })` listeners matching this payload's event. */
  private dispatchPresence(payload: PresencePayload): void {
    for (const r of this.presenceRegistrations) {
      if (r.event === payload.event) r.handler(payload);
    }
  }

  /** Close the WebSocket, stop auto-reconnect, and drop all listeners. */
  unsubscribe(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const ws = this.socket;
      this.socket = null; // detach first so the close handler is a no-op
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    this.registrations.length = 0;
    this.presenceRegistrations.length = 0;
    this.presenceMap = {};
    this.trackedState = undefined;
    this.isTracking = false;
    this.lastSeq = null;
    this.reconnectAttempts = 0;
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

  /**
   * Get a channel handle. Optionally override the project id, or set the
   * Supabase-style presence grouping key via `config.presence.key`.
   */
  channel(
    name: string,
    opts: { projectId?: string; config?: { presence?: { key?: string } } } = {},
  ): RealtimeChannelClient {
    return new RealtimeChannelClient(this.client, name, opts.projectId, opts.config?.presence?.key);
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
