/**
 * realtime-presence.test.mjs — fixture for SDK realtime presence (tsk_1f2ec255).
 * Network-free: a fake WebSocket (with send capture) + fake timers drive the
 * channel deterministically.
 *
 * THE GAP (verified in source): RealtimeChannelClient.on('presence', ...) was a
 * documented NO-OP — migrated Supabase chat/collab/multiplayer code compiled but
 * silently did nothing. This asserts the fix: presence sync/join/leave frames
 * from the server are dispatched to `.on('presence', { event })` listeners and
 * maintained in `presenceState()`, and `track()`/`untrack()` send the matching
 * control frames over the socket (re-tracking automatically after a reconnect).
 *
 * Run after a build:  npm run build && node test/realtime-presence.test.mjs
 */
import { applyPresenceFrame } from '../dist/esm/resources/realtime-presence.js';
import { RealtimeChannelClient } from '../dist/esm/resources/realtime.js';

let passed = 0, failed = 0;
const fails = [];
function check(name, cond) {
  if (cond) { passed++; process.stdout.write(`OK   ${name}\n`); }
  else { failed++; fails.push(name); process.stdout.write(`FAIL ${name}\n`); }
}

/* ── pure: applyPresenceFrame maintains Supabase-shaped state ─────── */

{
  // sync replaces the whole state.
  const r1 = applyPresenceFrame({}, {
    type: 'sw_presence_sync',
    presence: { usr_alice: [{ presence_ref: 'rA', name: 'Alice' }] },
  });
  check('sync returns event=sync', r1 && r1.payload.event === 'sync');
  check('sync sets full state', r1.state.usr_alice?.length === 1 && r1.state.usr_alice[0].name === 'Alice');

  // join adds a presence under its key.
  const r2 = applyPresenceFrame(r1.state, {
    type: 'sw_presence_join',
    key: 'usr_bob',
    newPresences: [{ presence_ref: 'rB', name: 'Bob' }],
  });
  check('join returns event=join with key', r2 && r2.payload.event === 'join' && r2.payload.key === 'usr_bob');
  check('join carries newPresences', r2.payload.newPresences[0].presence_ref === 'rB');
  check('join exposes currentPresences for the key', r2.payload.currentPresences.length === 1);
  check('join adds to state without dropping others', r2.state.usr_alice.length === 1 && r2.state.usr_bob.length === 1);

  // join is idempotent per presence_ref (re-track replaces, never duplicates).
  const r3 = applyPresenceFrame(r2.state, {
    type: 'sw_presence_join',
    key: 'usr_bob',
    newPresences: [{ presence_ref: 'rB', name: 'Bob v2' }],
  });
  check('re-join replaces by presence_ref (no dupes)', r3.state.usr_bob.length === 1 && r3.state.usr_bob[0].name === 'Bob v2');

  // two connections same key coexist (multi-tab).
  const r4 = applyPresenceFrame(r3.state, {
    type: 'sw_presence_join',
    key: 'usr_bob',
    newPresences: [{ presence_ref: 'rB2', name: 'Bob tab2' }],
  });
  check('distinct refs same key coexist', r4.state.usr_bob.length === 2);

  // leave removes by ref; empty key is deleted.
  const r5 = applyPresenceFrame(r4.state, {
    type: 'sw_presence_leave',
    key: 'usr_alice',
    leftPresences: [{ presence_ref: 'rA', name: 'Alice' }],
  });
  check('leave returns event=leave', r5 && r5.payload.event === 'leave' && r5.payload.key === 'usr_alice');
  check('leave carries leftPresences', r5.payload.leftPresences[0].presence_ref === 'rA');
  check('leave removes the only ref AND deletes the empty key', !('usr_alice' in r5.state));
  check('leave leaves other keys intact', r5.state.usr_bob.length === 2);

  // leave of one ref keeps the other under the same key.
  const r6 = applyPresenceFrame(r5.state, {
    type: 'sw_presence_leave',
    key: 'usr_bob',
    leftPresences: [{ presence_ref: 'rB', name: 'Bob v2' }],
  });
  check('partial leave keeps the surviving ref', r6.state.usr_bob.length === 1 && r6.state.usr_bob[0].presence_ref === 'rB2');

  // a non-presence frame (e.g. the resume control frame) falls through.
  check('non-presence frame returns null', applyPresenceFrame({}, { type: 'sw_resume', gap: true }) === null);
  check('non-object frame returns null', applyPresenceFrame({}, 'nope') === null);
  // applyPresenceFrame must not mutate the input state.
  const before = { k: [{ presence_ref: 'r1' }] };
  applyPresenceFrame(before, { type: 'sw_presence_join', key: 'k', newPresences: [{ presence_ref: 'r2' }] });
  check('applyPresenceFrame does not mutate input state', before.k.length === 1);
}

/* ── integration: channel wiring with a fake WebSocket ───────────── */

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.sent = [];
    this.readyState = 1; // OPEN — track()/untrack() send immediately in tests
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  send(data) { this.sent.push(typeof data === 'string' ? JSON.parse(data) : data); }
  close() { this.emit('close', {}); }
}

const realWS = globalThis.WebSocket;
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;

let pendingTimers = [];
globalThis.WebSocket = FakeWebSocket;
globalThis.setTimeout = (fn) => { pendingTimers.push(fn); return pendingTimers.length; };
globalThis.clearTimeout = (id) => { if (id) pendingTimers[id - 1] = null; };
const flushTimers = () => {
  const due = pendingTimers.filter(Boolean);
  pendingTimers = [];
  due.forEach((fn) => fn());
};

const fakeClient = {
  requireProjectId: () => 'p1',
  realtimeToken: 'smt_token',
  wsBaseUrl: 'wss://api.example',
};

try {
  FakeWebSocket.instances = [];
  pendingTimers = [];

  const syncs = [];
  const joins = [];
  const leaves = [];
  const broadcasts = [];

  const ch = new RealtimeChannelClient(fakeClient, 'room:lobby');
  ch.on('broadcast', { event: 'msg' }, (p) => broadcasts.push(p.payload));
  ch.on('presence', { event: 'sync' }, () => syncs.push(ch.presenceState()));
  ch.on('presence', { event: 'join' }, (p) => joins.push(p));
  ch.on('presence', { event: 'leave' }, (p) => leaves.push(p));
  ch.subscribe();

  const ws1 = FakeWebSocket.instances[0];
  ws1.emit('open', {});

  // Server syncs the existing members to this freshly-subscribed client.
  ws1.emit('message', { data: JSON.stringify({
    type: 'sw_presence_sync',
    presence: { usr_alice: [{ presence_ref: 'rA', name: 'Alice' }] },
  }) });
  check('sync handler fired for new subscriber', syncs.length === 1);
  check('presenceState() reflects synced members', ch.presenceState().usr_alice?.[0].name === 'Alice');
  check('presence frame NOT delivered to broadcast listener', broadcasts.length === 0);

  // A peer joins.
  ws1.emit('message', { data: JSON.stringify({
    type: 'sw_presence_join',
    key: 'usr_bob',
    newPresences: [{ presence_ref: 'rB', name: 'Bob' }],
  }) });
  check('join handler fired', joins.length === 1 && joins[0].key === 'usr_bob');
  check('presenceState() updated on join', ch.presenceState().usr_bob?.[0].name === 'Bob');

  // A peer leaves.
  ws1.emit('message', { data: JSON.stringify({
    type: 'sw_presence_leave',
    key: 'usr_bob',
    leftPresences: [{ presence_ref: 'rB', name: 'Bob' }],
  }) });
  check('leave handler fired', leaves.length === 1 && leaves[0].key === 'usr_bob');
  check('presenceState() updated on leave', !('usr_bob' in ch.presenceState()));

  // A normal broadcast still reaches broadcast listeners (presence didn't break it).
  ws1.emit('message', { data: JSON.stringify({ type: 'event', event: 'msg', data: { hi: 1 }, seq: 1 }) });
  check('broadcast still works alongside presence', broadcasts.length === 1 && broadcasts[0].hi === 1);

  /* ── track()/untrack() send control frames over the socket ──────── */

  const status = ch.track({ name: 'Me', online_at: 't0' });
  check('track() returns ok', status === 'ok');
  const trackFrame = ws1.sent.find((m) => m.type === 'sw_presence_track');
  check('track() sent a sw_presence_track frame', !!trackFrame);
  check('track() frame carries the state', trackFrame && trackFrame.state.name === 'Me');

  const ustatus = ch.untrack();
  check('untrack() returns ok', ustatus === 'ok');
  check('untrack() sent a sw_presence_untrack frame', ws1.sent.some((m) => m.type === 'sw_presence_untrack'));

  /* ── presence is re-established automatically after a reconnect ──── */

  ch.track({ name: 'Me', online_at: 't1' });
  const sentBeforeDrop = FakeWebSocket.instances.length;
  ws1.emit('close', {});                 // connection drops
  flushTimers();                         // backoff elapses → reconnect
  check('reconnect opened a new socket', FakeWebSocket.instances.length === sentBeforeDrop + 1);
  const ws2 = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  ws2.emit('open', {});                  // reconnected socket opens
  check('presence re-tracked automatically on reconnect', ws2.sent.some((m) => m.type === 'sw_presence_track' && m.state.online_at === 't1'));

  /* ── unsubscribe() clears presence state + stops re-tracking ────── */

  ch.unsubscribe();
  check('unsubscribe clears presenceState', Object.keys(ch.presenceState()).length === 0);
} finally {
  globalThis.WebSocket = realWS;
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
}

if (failed) {
  process.stdout.write(`\n[FAIL realtime-presence] ${failed} failed:\n  - ${fails.join('\n  - ')}\n`);
  process.exit(1);
}
process.stdout.write(`\n[ OK  realtime-presence] ${passed} assertions passed\n`);
