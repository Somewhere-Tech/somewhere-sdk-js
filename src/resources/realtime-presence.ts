/**
 * Pure, network-free presence-state reducer for realtime channels (tsk_1f2ec255).
 *
 * The server (realtime DO) emits Supabase-shaped presence frames over the
 * socket; this module folds an incoming frame into the channel's
 * `presenceState()` and produces the payload handed to a
 * `.on('presence', { event }, ...)` listener. Kept dependency-free (no Client /
 * WebSocket imports) so the merge logic is unit-tested without a live socket —
 * RealtimeChannelClient composes it. Mirrors the server-side counterpart in the
 * worker (durable-objects/realtime-presence.ts).
 */
import type { Presence, RealtimePresenceState, PresencePayload } from '../types.js';

/** Shallow-clone the state map (each key gets a fresh array) so callers never mutate the input. */
function cloneState(state: RealtimePresenceState): RealtimePresenceState {
  const out: RealtimePresenceState = {};
  for (const k of Object.keys(state)) out[k] = state[k].slice();
  return out;
}

/** Coerce an arbitrary `presence` object into a valid `{ [key]: Presence[] }` map. */
function normalizeState(raw: unknown): RealtimePresenceState {
  const out: RealtimePresenceState = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v as Presence[];
    }
  }
  return out;
}

/**
 * Apply one incoming presence frame to `state`. Returns the next state plus the
 * listener payload, or `null` if the frame isn't a presence frame (so callers
 * can fall through to other control-frame handling, e.g. `sw_resume`). Never
 * mutates the input `state`.
 */
export function applyPresenceFrame(
  state: RealtimePresenceState,
  frame: unknown,
): { state: RealtimePresenceState; payload: PresencePayload } | null {
  if (!frame || typeof frame !== 'object') return null;
  const type = (frame as { type?: unknown }).type;

  if (type === 'sw_presence_sync') {
    const next = normalizeState((frame as { presence?: unknown }).presence);
    return { state: next, payload: { event: 'sync' } };
  }

  if (type === 'sw_presence_join') {
    const f = frame as { key?: unknown; newPresences?: unknown };
    if (typeof f.key !== 'string' || !Array.isArray(f.newPresences)) return null;
    const newPresences = f.newPresences as Presence[];
    const next = cloneState(state);
    const arr = (next[f.key] ||= []);
    for (const p of newPresences) {
      const i = arr.findIndex((e) => e.presence_ref === p.presence_ref);
      if (i >= 0) arr[i] = p; // re-track replaces by ref — never duplicates
      else arr.push(p);
    }
    return {
      state: next,
      payload: { event: 'join', key: f.key, newPresences, currentPresences: next[f.key].slice() },
    };
  }

  if (type === 'sw_presence_leave') {
    const f = frame as { key?: unknown; leftPresences?: unknown };
    if (typeof f.key !== 'string' || !Array.isArray(f.leftPresences)) return null;
    const leftPresences = f.leftPresences as Presence[];
    const next = cloneState(state);
    const refs = new Set(leftPresences.map((p) => p.presence_ref));
    const remaining = (next[f.key] || []).filter((e) => !refs.has(e.presence_ref));
    if (remaining.length) next[f.key] = remaining;
    else delete next[f.key];
    return {
      state: next,
      payload: { event: 'leave', key: f.key, leftPresences, currentPresences: remaining },
    };
  }

  return null;
}

/** True for the server's `sw_presence_error` frame (e.g. a too-large track blob). */
export function isPresenceErrorFrame(frame: unknown): boolean {
  return !!frame && typeof frame === 'object' && (frame as { type?: unknown }).type === 'sw_presence_error';
}
