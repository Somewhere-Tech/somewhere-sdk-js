/**
 * Browser-bound social sign-in through the packaged handler (platform tsk_ec24c4ba).
 *
 * GET /<provider>-url awaits sw.auth.oauthStart(provider, { redirect_uri }),
 * which stages this attempt's HttpOnly verifier cookie on the response; the
 * browser API (JSON { url }) is unchanged. The old synchronous URL builders
 * are never called, and a runtime without oauthStart answers 501 with a
 * redeploy instruction instead of starting an unbound sign-in. The exchange
 * routes keep their shape.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { somewhereAuth } from '@somewhere-tech/sdk/server';

const ORIGIN = 'https://app.somewhere.site';
const PROVIDERS = ['google', 'github', 'discord'];
const bundle = { token: 'access', access_token: 'access', refresh_token: 'refresh', user: { id: 'u1', email: 'a@x.test' } };

function platform({ withStart = true } = {}) {
  const calls = [];
  const legacy = (name) => () => { calls.push([name]); throw new Error(`${name} must never be called`); };
  const auth = {
    async fromRequest() { return null; },
    googleUrl: legacy('googleUrl'), githubUrl: legacy('githubUrl'), discordUrl: legacy('discordUrl'),
    async googleExchange(opts) { calls.push(['googleExchange', opts]); return bundle; },
    async githubExchange(opts) { calls.push(['githubExchange', opts]); return bundle; },
    async discordExchange(opts) { calls.push(['discordExchange', opts]); return bundle; },
  };
  if (withStart) {
    auth.oauthStart = async (provider, opts) => {
      calls.push(['oauthStart', provider, opts]);
      if (opts.redirect_uri === 'limit') throw Object.assign(new Error('Too many sign-in attempts are open in this browser.'), { code: 'OAUTH_START_LIMIT', status: 429 });
      return `https://api.somewhere.tech/v1/auth/${provider}?challenge=c-${provider}`;
    };
  }
  return { sw: { auth }, calls };
}
const get = async (p, path) => {
  const res = await somewhereAuth(new Request(ORIGIN + '/api/auth' + path, { headers: { Origin: ORIGIN } }), p.sw);
  return { status: res.status, body: await res.json() };
};

for (const provider of PROVIDERS) {
  test(`${provider}: GET /${provider}-url awaits oauthStart and returns { url }`, async () => {
    const p = platform();
    const res = await get(p, `/${provider}-url`);
    assert.deepEqual(res, { status: 200, body: { url: `https://api.somewhere.tech/v1/auth/${provider}?challenge=c-${provider}` } });
    assert.deepEqual(p.calls, [['oauthStart', provider, { redirect_uri: `${ORIGIN}/api/auth/callback` }]],
      'one oauthStart call with the default callback; no legacy URL builder');
  });

  test(`${provider}: an explicit redirect_uri is passed through`, async () => {
    const p = platform();
    await get(p, `/${provider}-url?redirect_uri=${encodeURIComponent(`${ORIGIN}/done`)}`);
    assert.deepEqual(p.calls, [['oauthStart', provider, { redirect_uri: `${ORIGIN}/done` }]]);
  });

  test(`${provider}: a runtime without oauthStart answers 501 and starts nothing`, async () => {
    const p = platform({ withStart: false });
    const res = await get(p, `/${provider}-url`);
    assert.equal(res.status, 501);
    assert.equal(res.body.error, 'OAUTH_START_UNAVAILABLE');
    assert.match(res.body.message, /Redeploy/);
    assert.equal(res.body.url, undefined, 'no sign-in URL is returned');
    assert.deepEqual(p.calls, [], 'the old unbound URL builders are never used as a fallback');
  });

  test(`${provider}: the exchange route keeps its shape`, async () => {
    const p = platform();
    const res = await somewhereAuth(new Request(ORIGIN + `/api/auth/${provider}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Sw-Auth-Mode': 'header' },
      body: JSON.stringify({ code: 'final-code' }),
    }), p.sw);
    assert.equal(res.status, 200);
    assert.deepEqual(p.calls, [[`${provider}Exchange`, { code: 'final-code' }]]);
  });
}

test('a refused start keeps its status and carries no credential', async () => {
  const p = platform();
  const res = await get(p, `/github-url?redirect_uri=limit`);
  assert.equal(res.status, 429);
  assert.equal(res.body.url, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /access|refresh|verifier/i);
});

test('only GET starts a sign-in', async () => {
  const p = platform();
  const res = await somewhereAuth(new Request(ORIGIN + '/api/auth/google-url', { method: 'POST', headers: { Origin: ORIGIN } }), p.sw);
  assert.equal(res.status, 404);
  assert.deepEqual(p.calls, []);
});
