/**
 * realtime-reconnect.test.mjs — fixture for SDK realtime auto-reconnect +
 * `?since` resume (tsk_e70c3713). Network-free: a fake WebSocket + fake
 * timers drive the reconnect state machine deterministically.
 *
 * THE GAP (verified in source): RealtimeChannelClient.subscribe() reported
 * 'CLOSED' on socket close and gave up — a flaky-mobile client that dropped
 * its connection stayed disconnected forever. This asserts the fix:
 *   - on close, the client RECONNECTS (re-subscribes the same channel)
 *   - the reconnect URL carries `?since=<lastSeq>` so the server replays
 *     exactly what was missed
 *   - backoff grows and is bounded; intentional unsubscribe() does NOT reconnect
 *
 * Run after a build:  npm run build && node test/realtime-reconnect.test.mjs
 */
import {
  backoffCeiling,
  jitter,
  buildSubscribeUrl,
  frameSeq,
  isControlFrame,
  DEFAULT_BACKOFF,
} from '../dist/esm/resources/realtime-reconnect.js';
import { RealtimeChannelClient } from '../dist/esm/resources/realtime.js';

let passed = 0, failed = 0;
const fails = [];
function check(name, cond) {
  if (cond) { passed++; process.stdout.write(`OK   ${name}\n`); }
  else { failed++; fails.push(name); process.stdout.write(`FAIL ${name}\n`); }
}

/* ── pure: exponential backoff, bounded ──────────────────────────── */

check('backoff attempt 0 = base', backoffCeiling(0) === DEFAULT_BACKOFF.baseMs);
check('backoff grows exponentially', backoffCeiling(1) === DEFAULT_BACKOFF.baseMs * DEFAULT_BACKOFF.factor);
check('backoff is bounded by maxMs', backoffCeiling(100) === DEFAULT_BACKOFF.maxMs);
check('backoff is non-decreasing', backoffCeiling(3) >= backoffCeiling(2) && backoffCeiling(2) >= backoffCeiling(1));

/* ── pure: full jitter stays within [0, ceiling] ─────────────────── */

check('jitter(1000, ()=>0.5) = 500', jitter(1000, () => 0.5) === 500);
check('jitter(1000, ()=>0) = 0', jitter(1000, () => 0) === 0);
check('jitter never exceeds the ceiling', jitter(1000, () => 0.999) < 1000);

/* ── pure: subscribe URL with / without resume cursor ────────────── */

const base = { wsBaseUrl: 'wss://api.example', projectId: 'p1', channel: 'room:lobby', token: 'smt_x' };
const u0 = buildSubscribeUrl({ ...base });
check('url has project_id, channel, token', u0.includes('project_id=p1') && u0.includes('channel=room%3Alobby') && u0.includes('token=smt_x'));
check('url WITHOUT since omits the param', !u0.includes('since='));
check('url WITH since=5 includes it', buildSubscribeUrl({ ...base, since: 5 }).includes('since=5'));
check('url WITH since=0 includes it (0 is a valid cursor)', buildSubscribeUrl({ ...base, since: 0 }).includes('since=0'));
check('url with null since omits the param', !buildSubscribeUrl({ ...base, since: null }).includes('since='));

/* ── pure: frame seq extraction + control-frame detection ────────── */

check('frameSeq reads numeric seq', frameSeq({ seq: 3 }) === 3);
check('frameSeq null when absent', frameSeq({ type: 'event' }) === null);
check('frameSeq null for non-numeric', frameSeq({ seq: 'x' }) === null);
check('frameSeq null for non-object', frameSeq('nope') === null);
check('isControlFrame true for sw_resume', isControlFrame({ type: 'sw_resume', gap: true }) === true);
check('isControlFrame false for event', isControlFrame({ type: 'event' }) === false);
check('isControlFrame false for message', isControlFrame({ type: 'message' }) === false);

/* ── integration: reconnect re-subscribes with ?since ────────────── */

// Controllable fakes for WebSocket + timers (no real network / clock).
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closedByClient = false;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  close() { this.closedByClient = true; this.emit('close', {}); }
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

// Minimal fake Client — RealtimeChannelClient only needs these members to subscribe.
const fakeClient = {
  requireProjectId: () => 'p1',
  realtimeToken: 'smt_token',
  wsBaseUrl: 'wss://api.example',
};

try {
  FakeWebSocket.instances = [];
  const received = [];
  const statuses = [];
  const ch = new RealtimeChannelClient(fakeClient, 'room:lobby');
  ch.on('broadcast', { event: 'msg' }, (p) => received.push(p.payload));
  ch.subscribe((s) => statuses.push(s));

  check('subscribe opens exactly one socket', FakeWebSocket.instances.length === 1);
  check('first connect has NO since cursor', !FakeWebSocket.instances[0].url.includes('since='));

  const ws1 = FakeWebSocket.instances[0];
  ws1.emit('open', {});
  check('open fires SUBSCRIBED', statuses[statuses.length - 1] === 'SUBSCRIBED');

  // Two live messages arrive with seqs 1, 2.
  ws1.emit('message', { data: JSON.stringify({ type: 'event', event: 'msg', data: { n: 1 }, seq: 1 }) });
  ws1.emit('message', { data: JSON.stringify({ type: 'event', event: 'msg', data: { n: 2 }, seq: 2 }) });
  check('live messages dispatched to listener', received.length === 2 && received[1].n === 2);

  // A control frame must NOT reach broadcast listeners.
  ws1.emit('message', { data: JSON.stringify({ type: 'sw_resume', gap: false }) });
  check('control frame is not dispatched as a message', received.length === 2);

  // Connection drops.
  ws1.emit('close', {});
  check('close fires CLOSED status', statuses[statuses.length - 1] === 'CLOSED');
  check('a reconnect was scheduled', pendingTimers.filter(Boolean).length === 1);

  // Backoff elapses → reconnect.
  flushTimers();
  check('reconnect opened a second socket (re-subscribe)', FakeWebSocket.instances.length === 2);
  check('reconnect URL carries since=2 (last seen seq)', FakeWebSocket.instances[1].url.includes('since=2'));

  // The reconnected socket keeps the SAME listeners (re-subscribe, not a fresh channel).
  const ws2 = FakeWebSocket.instances[1];
  ws2.emit('open', {});
  ws2.emit('message', { data: JSON.stringify({ type: 'event', event: 'msg', data: { n: 3 }, seq: 3 }) });
  check('reconnected socket still delivers to original listener', received.length === 3 && received[2].n === 3);

  /* ── intentional unsubscribe() must NOT reconnect ──────────────── */
  FakeWebSocket.instances = [];
  pendingTimers = [];
  const ch2 = new RealtimeChannelClient(fakeClient, 'room:two');
  ch2.subscribe();
  check('second channel opened one socket', FakeWebSocket.instances.length === 1);
  ch2.unsubscribe();
  check('unsubscribe schedules NO reconnect', pendingTimers.filter(Boolean).length === 0);
  check('unsubscribe opens no new socket', FakeWebSocket.instances.length === 1);

  /* ── additive protocol: legacy servers/frames keep working ──────── */
  FakeWebSocket.instances = [];
  pendingTimers = [];
  const legacyReceived = [];
  const legacy = new RealtimeChannelClient(fakeClient, 'room:legacy');
  legacy.on('broadcast', { event: 'msg' }, (p) => legacyReceived.push(p.payload));
  legacy.subscribe();
  const legacyWs = FakeWebSocket.instances[0];
  legacyWs.emit('open', {});
  legacyWs.emit('message', {
    data: JSON.stringify({ type: 'event', event: 'msg', data: { compatible: true } }),
  });
  check('legacy frame without seq still reaches listeners', legacyReceived[0]?.compatible === true);
  legacyWs.emit('close', {});
  flushTimers();
  check('legacy reconnect still opens a replacement socket', FakeWebSocket.instances.length === 2);
  check('legacy reconnect without a cursor omits since', !FakeWebSocket.instances[1].url.includes('since='));
  legacy.unsubscribe();
} finally {
  globalThis.WebSocket = realWS;
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
}

if (failed) {
  process.stdout.write(`\n[FAIL realtime-reconnect] ${failed} failed:\n  - ${fails.join('\n  - ')}\n`);
  process.exit(1);
}
process.stdout.write(`\n[ OK  realtime-reconnect] ${passed} assertions passed\n`);
