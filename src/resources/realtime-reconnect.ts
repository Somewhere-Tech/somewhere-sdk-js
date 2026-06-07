/**
 * Pure helpers for realtime auto-reconnect + `?since` resume (tsk_e70c3713).
 *
 * Kept dependency-free (no Client / WebSocket imports) so the reconnect math
 * and wire-format decisions can be unit-tested without a live socket — see
 * test/realtime-reconnect.test.mjs. RealtimeChannelClient composes these.
 */

export interface BackoffOptions {
  /** Delay for the first retry (attempt 0), in ms. */
  baseMs: number;
  /** Hard ceiling — backoff never waits longer than this. */
  maxMs: number;
  /** Multiplier applied per attempt. */
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 15_000,
  factor: 2,
};

/**
 * Exponential backoff CEILING for a given 0-based attempt, clamped to
 * `maxMs`. Deterministic — jitter is applied separately so this stays
 * testable. `Math.min` absorbs the `Infinity` from a large `factor**attempt`.
 */
export function backoffCeiling(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  const raw = opts.baseMs * Math.pow(opts.factor, Math.max(0, attempt));
  return Math.min(raw, opts.maxMs);
}

/**
 * Full jitter: a random delay in `[0, ceiling]`. Spreading reconnects avoids
 * a thundering herd when many clients drop at once (e.g. a server blip).
 * `rng` is injectable for deterministic tests.
 */
export function jitter(ceiling: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * ceiling);
}

/**
 * Build the realtime subscribe URL, appending `?since=<seq>` when resuming so
 * the server replays the messages missed since that cursor. `since === 0` is a
 * valid cursor (replay everything still buffered); only `null`/`undefined`
 * omit it.
 */
export function buildSubscribeUrl(args: {
  wsBaseUrl: string;
  projectId: string;
  channel: string;
  token: string;
  since?: number | null;
}): string {
  let url =
    `${args.wsBaseUrl}/realtime/subscribe` +
    `?project_id=${encodeURIComponent(args.projectId)}` +
    `&channel=${encodeURIComponent(args.channel)}` +
    `&token=${encodeURIComponent(args.token)}`;
  if (typeof args.since === 'number' && Number.isFinite(args.since) && args.since >= 0) {
    url += `&since=${encodeURIComponent(String(args.since))}`;
  }
  return url;
}

/** The monotonic `seq` stamped on an incoming realtime frame, or null. */
export function frameSeq(frame: unknown): number | null {
  if (frame && typeof frame === 'object') {
    const s = (frame as { seq?: unknown }).seq;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return null;
}

/**
 * True if the frame is a platform control frame (`sw_*` type, e.g. the
 * `sw_resume` gap signal) and must NOT be delivered to broadcast listeners.
 */
export function isControlFrame(frame: unknown): boolean {
  if (!frame || typeof frame !== 'object') return false;
  const t = (frame as { type?: unknown }).type;
  return typeof t === 'string' && t.startsWith('sw_');
}
