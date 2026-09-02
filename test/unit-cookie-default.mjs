/**
 * The session cookie is the DEFAULT, not a header opt-in (platform tsk_d05a6cfb).
 *
 * THE HOLE: somewhereAuth only called sw.auth.setSessionCookies when the caller
 * sent `X-Sw-Auth-Mode: cookie`. The @somewhere-tech/sdk/auth client sends it; a
 * plain `fetch('/api/auth/login', { credentials: 'include' })` does not. So the
 * browser flow we publish — AGENT.md's lead example, docs({ topic:
 * 'auth-client' }) §3 — returned 200 with NO Set-Cookie against the scaffold's
 * `api/auth/[...path]` route: sign-up succeeded, /api/auth/me answered
 * { user: null }, and every protected route 401'd.
 *
 * THE FIX under test: a successful sign-in always stages the httpOnly pair when
 * the runtime can mint it. The header now selects the RESPONSE BODY only.
 *
 * Rule-9 fixtures run BOTH directions: the cookie appears where it was missing,
 * AND every caller that worked before gets the same body it got before —
 * cookie-mode clients, token-bundle clients, an explicit opt-out, an older
 * runtime with no setSessionCookies, a bundle with no token pair, a failed
 * sign-in, and an app that sets a cookie of its own.
 */
import { somewhereAuth } from '@somewhere-tech/sdk/server';

let passed = 0;
let failed = 0;
const check = (name, condition) => {
  if (condition) { passed++; process.stdout.write(`OK   ${name}\n`); }
  else { failed++; process.stdout.write(`FAIL ${name}\n`); }
};

const USER = { id: 'usr_1', email: 'a@b.co', role: 'user', display_name: null };
const BUNDLE = {
  user: USER,
  token: 'access.jwt',
  access_token: 'access.jwt',
  refresh_token: 'refresh.jwt',
  expires_in: 3600,
};

/** A fake `sw` whose auth namespace records what the handler asked the runtime
 *  to do. `cookies` mirrors the runtime's __sw_pendingCookies: the platform
 *  stages `__Host-token` + `__Host-sw_refresh_token`, nothing else. */
function makeSw({ canCookie = true, bundle = BUNDLE, fail = null } = {}) {
  const staged = [];
  const calls = [];
  const auth = {
    async signup(opts) { calls.push(['signup', opts]); if (fail) throw fail; return bundle; },
    async login(opts) { calls.push(['login', opts]); if (fail) throw fail; return bundle; },
    async logout() { return { ok: true }; },
    async fromRequest() { return staged.length ? USER : null; },
    async signInWithOtp() { return { ok: true }; },
    async verifyOtp() { if (fail) throw fail; return bundle; },
    async googleUrl() { return { url: 'https://google/x' }; },
    async googleExchange() { if (fail) throw fail; return bundle; },
    async githubUrl() { return { url: 'https://github/x' }; },
    async githubExchange() { if (fail) throw fail; return bundle; },
    async discordUrl() { return { url: 'https://discord/x' }; },
    async discordExchange() { if (fail) throw fail; return bundle; },
  };
  if (canCookie) {
    auth.setSessionCookies = (access, refresh) => {
      staged.push(`__Host-token=${access}`, `__Host-sw_refresh_token=${refresh}`);
    };
    auth.signupWithCookie = async (req, email, password) => {
      calls.push(['signupWithCookie', { email, password }]);
      if (fail) throw fail;
      auth.setSessionCookies(bundle.access_token, bundle.refresh_token);
      return USER;
    };
    auth.loginWithCookie = async (req, email, password) => {
      calls.push(['loginWithCookie', { email, password }]);
      if (fail) throw fail;
      auth.setSessionCookies(bundle.access_token, bundle.refresh_token);
      return USER;
    };
    auth.logoutWithCookie = async () => { staged.length = 0; return { ok: true }; };
  }
  return { sw: { auth }, staged, calls };
}

const post = (path, headers = {}) => new Request(`https://app.somewhere.site${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ email: 'a@b.co', password: 'hunter2hunter2' }),
});

async function run(path, headers, opts) {
  const ctx = makeSw(opts);
  const res = await somewhereAuth(post(path, headers), ctx.sw);
  return { res, body: await res.json(), staged: ctx.staged, calls: ctx.calls };
}

// ── DIRECTION 1: the cookie now exists where the docs said it did ────────────

for (const path of ['/api/auth/signup', '/api/auth/login']) {
  const r = await run(path, {});                      // exactly AGENT.md's fetch: no mode header
  check(`${path} with no X-Sw-Auth-Mode stages the platform session pair`,
    r.staged.length === 2
    && r.staged[0] === '__Host-token=access.jwt'
    && r.staged[1] === '__Host-sw_refresh_token=refresh.jwt');
  check(`${path} with no X-Sw-Auth-Mode still returns the 0.1.x token bundle body`,
    r.res.status === 200
    && r.body.access_token === 'access.jwt'
    && r.body.token === 'access.jwt'
    && r.body.refresh_token === 'refresh.jwt'
    && r.body.user.id === 'usr_1');
}

for (const [path, method] of [
  ['/api/auth/magic-link/verify', 'verifyOtp'],
  ['/api/auth/google', 'googleExchange'],
  ['/api/auth/github', 'githubExchange'],
  ['/api/auth/discord', 'discordExchange'],
]) {
  const r = await run(path, {});
  check(`${path} (${method}) stages the session pair with no mode header`, r.staged.length === 2);
}

// ── DIRECTION 2: nothing that worked before changed ──────────────────────────

const cookieMode = await run('/api/auth/login', { 'X-Sw-Auth-Mode': 'cookie' });
check('cookie-mode client: unchanged handshake body, no token material in the body',
  cookieMode.body.cookie_session === true
  && cookieMode.body.user.id === 'usr_1'
  && cookieMode.body.access_token === undefined
  && cookieMode.body.refresh_token === undefined);
check('cookie-mode client: still routed through loginWithCookie',
  cookieMode.calls.some(([name]) => name === 'loginWithCookie'));

const optOut = await run('/api/auth/login', { 'X-Sw-Auth-Mode': 'token' });
check('explicit token mode sets NO cookie (the rule-9 opt-out)', optOut.staged.length === 0);
check('explicit token mode returns the token bundle unchanged',
  optOut.body.access_token === 'access.jwt' && optOut.body.refresh_token === 'refresh.jwt');

const oldRuntime = await run('/api/auth/login', {}, { canCookie: false });
check('runtime without setSessionCookies: no throw, no cookie, token bundle body',
  oldRuntime.res.status === 200
  && oldRuntime.staged.length === 0
  && oldRuntime.body.access_token === 'access.jwt');

const noPair = await run('/api/auth/login', {}, { bundle: { mfa_required: true, user: USER } });
check('a bundle with no token pair (mfa_required) stages nothing and passes the body through',
  noPair.staged.length === 0 && noPair.body.mfa_required === true);

const badCreds = Object.assign(new Error('Wrong email or password.'), { status: 401 });
const failedSignIn = await run('/api/auth/login', {}, { fail: badCreds });
check('a FAILED sign-in stages no cookie and stays a structured 4xx',
  failedSignIn.staged.length === 0
  && failedSignIn.res.status === 401
  && failedSignIn.body.error === 'AUTH_ERROR'
  && failedSignIn.body.message === 'Wrong email or password.');

const failedCookieSignIn = await run('/api/auth/login', { 'X-Sw-Auth-Mode': 'cookie' }, { fail: badCreds });
check('a FAILED cookie-mode sign-in stages no cookie either',
  failedCookieSignIn.staged.length === 0 && failedCookieSignIn.res.status === 401);

// An app that sets its own session cookie: the handler only ever adds the
// platform `__Host-` pair, and never reads, renames, or clears another name —
// so the app's own cookie survives untouched alongside it.
{
  const ctx = makeSw();
  ctx.staged.push('my_app_session=abc');            // the app's own cookie, set by the app
  const res = await somewhereAuth(post('/api/auth/login'), ctx.sw);
  await res.json();
  check("an app's own cookie is untouched; only the platform pair is added",
    ctx.staged.length === 3
    && ctx.staged[0] === 'my_app_session=abc'
    && ctx.staged.filter((c) => c.startsWith('__Host-')).length === 2);
}

// Non-sign-in routes never stage a session.
{
  const ctx = makeSw();
  const res = await somewhereAuth(
    new Request('https://app.somewhere.site/api/auth/me', { method: 'GET' }),
    ctx.sw,
  );
  await res.json();
  check('GET /me never stages a session cookie', ctx.staged.length === 0);
}
{
  const ctx = makeSw();
  await somewhereAuth(post('/api/auth/magic-link'), ctx.sw);
  check('POST /magic-link (send, not verify) never stages a session cookie', ctx.staged.length === 0);
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
