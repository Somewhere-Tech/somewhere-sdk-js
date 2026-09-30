import assert from 'node:assert/strict';
import test from 'node:test';
import { createSomewhereAuth } from '../dist/esm/auth/client.js';

const user = { id: 'fixture-user', email: 'fixture@example.invalid' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function auth() {
  const values = new Map([['sw_auth_user', JSON.stringify(user)]]);
  return createSomewhereAuth({ mode: 'cookie', mutationTimeoutMs: 20, storage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key),
  } });
}

test('successful finite JSON logout body is read; empty response remains confirmed', async () => {
  for (const response of [json({ ok: true }), new Response('{"ok":true}', { headers: { 'Content-Type': ' APPLICATION/JSON ; charset=utf-8 ' } }), new Response(null, { status: 204 })]) {
    globalThis.fetch = async () => response;
    const client = auth();
    await client.signOut();
    assert.equal(response.bodyUsed, response.body !== null);
    assert.equal(client.getState().status, 'signed-out');
    assert.equal(client.getState().signOutUnconfirmed, false);
  }
});

test('failed responses and non-JSON streams are not read; failures remain owed', async () => {
  for (const response of [json({ error: 'refused' }, 503), new Response('data: event\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), new Response('plain', { headers: { 'Content-Type': 'text/plain' } }), new Response('{}', { headers: { 'Content-Type': 'application/problem+json' } })]) {
    globalThis.fetch = async () => response;
    const client = auth();
    await client.signOut();
    assert.equal(response.bodyUsed, false);
    assert.equal(client.getState().signOutUnconfirmed, !response.ok);
    if (!response.ok) assert.equal(client.getState().error?.code, 'SIGN_OUT_UNCONFIRMED');
  }
  globalThis.fetch = async () => { throw new TypeError('fixture network failure'); };
  const client = auth();
  await client.signOut();
  assert.equal(client.getState().signOutUnconfirmed, true);
  assert.equal(client.getState().error?.code, 'SIGN_OUT_UNCONFIRMED');
});

test('pending/rejected body never holds the queue or rewrites newer sign-in state', async () => {
  let bodyController;
  const response = new Response(new ReadableStream({ start(controller) { bodyController = controller; } }), { headers: { 'Content-Type': 'application/json' } });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).endsWith('/logout') ? response : json({ cookie_session: true, user });
  };
  const client = auth();
  const logout = client.signOut();
  const login = client.signIn({ email: 'fixture@example.invalid', password: 'fixture-only' });
  await logout;
  await login;
  assert.deepEqual(calls, ['/api/auth/logout', '/api/auth/login']);
  assert.equal(response.bodyUsed, true);
  assert.equal(client.getState().status, 'authenticated');
  bodyController.error(new Error('fixture body failure'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(client.getState().status, 'authenticated');
  assert.equal(client.getState().signOutUnconfirmed, false);
  assert.equal(client.getState().error, null);
});
