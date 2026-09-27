// Session status and ordering (tsk_166b8ddf). Pure, no network; runs
// against the built package. Every race is driven with deferred responses so
// the order is exact, and each guard has a same-generation control proving
// genuine sign-outs and sign-ins still apply.
//
//   npm run build && node test/unit-session-status.mjs

import { createSomewhereAuth } from '@somewhere-tech/sdk/auth';

let failed = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

const A = { id: 'usr_a', email: 'a@example.com' };
const B = { id: 'usr_b', email: 'b@example.com' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const raw = (status, text) => new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

/** Browser-ish globals: cookie mode, a recording localStorage, storage events. */
function browser({ cachedUser = null } = {}) {
  const values = new Map();
  const writes = [];
  const storageHandlers = [];
  globalThis.document = {};
  globalThis.localStorage = {
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => { writes.push(k); values.set(k, v); },
    removeItem: (k) => { writes.push(`-${k}`); values.delete(k); },
  };
  globalThis.window = { addEventListener: (type, fn) => { if (type === 'storage') storageHandlers.push(fn); } };
  if (cachedUser) values.set('sw_auth_user', JSON.stringify(cachedUser));
  return {
    values,
    writes,
    /** Another tab wrote `sw_auth_user`. */
    otherTab(nextUser) {
      if (nextUser) values.set('sw_auth_user', JSON.stringify(nextUser));
      else values.delete('sw_auth_user');
      for (const fn of storageHandlers) fn({ key: 'sw_auth_user' });
    },
  };
}

/** fetch router: `routes[path]` returns a Response, a Promise of one, or throws. */
function server(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(String(input instanceof Request ? input.url : input), 'https://app.example').pathname;
    const entry = { path, init, done: false };
    calls.push(entry);
    try {
      const handler = routes[path];
      if (!handler) return json(404, {});
      const result = await handler(init, entry);
      return result;
    } finally {
      entry.done = true;
    }
  };
  return calls;
}

/** A response that never arrives unless the request is aborted. */
const hang = (init) => new Promise((_, reject) => {
  init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

async function settled(promise) {
  try { return { value: await promise }; } catch (error) { return { error }; }
}

// ---------------------------------------------------------------- status map

{
  browser({ cachedUser: A });
  server({ '/api/auth/me': () => json(200, { user: A }) });
  const auth = createSomewhereAuth();
  const before = auth.getState();
  check('a cached user starts unverified ("checking")', before.status === 'checking' && before.user?.id === 'usr_a');
  const seen = [];
  auth.onChange((s) => seen.push(s.status));
  const u = await auth.getUser();
  check('/me 200 → authenticated, getUser returns the user', auth.getState().status === 'authenticated' && u?.id === 'usr_a');
  check('onChange carries status (superset of { user, session })', seen[0] === 'checking' && seen.at(-1) === 'authenticated' && 'session' in auth.getState());
}

for (const [label, respond] of [['401', () => json(401, {})], ['{ user: null }', () => json(200, { user: null })]]) {
  browser({ cachedUser: A });
  server({ '/api/auth/me': respond });
  const auth = createSomewhereAuth();
  const u = await auth.getUser();
  check(`/me ${label} → signed-out (definitive)`, u === null && auth.getState().status === 'signed-out' && auth.getCachedUser() === null);
}

for (const [label, respond, code] of [
  ['503', () => json(503, {}), 503],
  ['network error', () => { throw new TypeError('fetch failed'); }, 0],
  ['unreadable 200 body', () => raw(200, 'not json'), 200],
  ['200 without a user field', () => json(200, { ok: true }), 200],
  ['200 with a malformed user', () => json(200, { user: { email: 'x' } }), 200],
]) {
  browser({ cachedUser: A });
  server({ '/api/auth/me': respond });
  const auth = createSomewhereAuth();
  const u = await auth.getUser();
  const s = auth.getState();
  check(`/me ${label} → indeterminate, last-known user kept, error ${code}`,
    s.status === 'indeterminate' && s.user?.id === 'usr_a' && u?.id === 'usr_a' && s.error?.code === 'SESSION_CHECK_FAILED' && s.error.status === code, s);
}
{
  browser();
  server({ '/api/auth/me': () => { throw new TypeError('fetch failed'); } });
  const auth = createSomewhereAuth();
  const u = await auth.getUser();
  check('network error with nothing cached → indeterminate, not signed-out', u === null && auth.getState().status === 'indeterminate');
}

// ------------------------------------------------------------ stale responses

{ // R1: a /me answered as A lands after signOut().
  browser({ cachedUser: A });
  const me = deferred();
  server({ '/api/auth/me': () => me.promise, '/api/auth/logout': () => json(200, { ok: true }) });
  const auth = createSomewhereAuth();
  const pending = auth.getUser();
  await tick();
  await auth.signOut();
  me.resolve(json(200, { user: A }));
  await pending;
  check('R1: a late /me cannot restore a signed-out user', auth.getState().status === 'signed-out' && auth.getCachedUser() === null);
}

{ // R2: a signed-out /me lands after signIn(B).
  browser();
  const me = deferred();
  server({ '/api/auth/me': () => me.promise, '/api/auth/login': () => json(200, { user: B, cookie_session: true }) });
  const auth = createSomewhereAuth();
  const pending = auth.getUser();
  await tick();
  await auth.signIn({ email: B.email, password: 'pw' });
  me.resolve(json(200, { user: null }));
  await pending;
  check('R2: a late signed-out /me cannot wipe a newer sign-in', auth.getState().status === 'authenticated' && auth.getCachedUser()?.id === 'usr_b');
}

{ // R2b: a /me answered as A lands after sign-out + sign-in as B.
  browser({ cachedUser: A });
  const me = deferred();
  server({
    '/api/auth/me': () => me.promise,
    '/api/auth/logout': () => json(200, { ok: true }),
    '/api/auth/login': () => json(200, { user: B, cookie_session: true }),
  });
  const auth = createSomewhereAuth();
  const pending = auth.getUser();
  await tick();
  await auth.signOut();
  await auth.signIn({ email: B.email, password: 'pw' });
  me.resolve(json(200, { user: A }));
  await pending;
  check('R2b: a late /me for A cannot replace B', auth.getCachedUser()?.id === 'usr_b' && auth.getState().status === 'authenticated');
}

{ // R3: auth.fetch started as A; its 401 lands after the switch to B.
  browser({ cachedUser: A });
  const api = deferred();
  server({
    '/api/x': () => api.promise,
    '/api/auth/logout': () => json(200, { ok: true }),
    '/api/auth/login': () => json(200, { user: B, cookie_session: true }),
  });
  const auth = createSomewhereAuth();
  const request = auth.fetch('/api/x');
  await tick();
  await auth.signOut();
  await auth.signIn({ email: B.email, password: 'pw' });
  api.resolve(json(401, { error: 'AUTH_REQUIRED' }));
  await request;
  check('R3: a stale 401 cannot clear a newer identity', auth.getCachedUser()?.id === 'usr_b' && auth.getState().status === 'authenticated');
}

{ // Control: a 401 for the current identity still signs out.
  browser({ cachedUser: A });
  server({ '/api/auth/me': () => json(200, { user: A }), '/api/x': () => json(401, {}) });
  const auth = createSomewhereAuth();
  await auth.getUser();
  await auth.fetch('/api/x');
  check('control: a current-generation 401 signs out', auth.getState().status === 'signed-out' && auth.getCachedUser() === null);
}

// -------------------------------------------------------- mutation ordering

{ // signIn, then signOut before the login answers: newer intent wins.
  browser();
  const login = deferred();
  const calls = server({ '/api/auth/login': () => login.promise, '/api/auth/logout': () => json(200, { ok: true }) });
  const auth = createSomewhereAuth();
  const signIn = settled(auth.signIn({ email: B.email, password: 'pw' }));
  await tick();
  const signOut = auth.signOut();
  await tick();
  check('signOut waits for the earlier queued login before calling /logout', calls.map((c) => c.path).join() === '/api/auth/login');
  check('signOut clears local state immediately', auth.getState().status === 'signed-out');
  login.resolve(json(200, { user: B, cookie_session: true }));
  const result = await signIn;
  await signOut;
  check('the superseded sign-in rejects AUTH_SUPERSEDED', result.error?.code === 'AUTH_SUPERSEDED', result);
  check('…and writes nothing: still signed out', auth.getState().status === 'signed-out' && auth.getCachedUser() === null);
  check('…and the server gets login, then logout', calls.map((c) => c.path).join() === '/api/auth/login,/api/auth/logout');
}

{ // signOut, then signIn: logout goes first, the sign-in stands.
  browser({ cachedUser: A });
  const logout = deferred();
  const calls = server({ '/api/auth/logout': () => logout.promise, '/api/auth/login': () => json(200, { user: B, cookie_session: true }) });
  const auth = createSomewhereAuth();
  const signOut = auth.signOut();
  const signIn = auth.signIn({ email: B.email, password: 'pw' });
  await tick();
  check('a later login waits for the earlier logout', calls.map((c) => c.path).join() === '/api/auth/logout');
  logout.resolve(json(200, { ok: true }));
  await signOut;
  const user = await signIn;
  check('signOut then signIn → authenticated as B, in call order', user?.id === 'usr_b' && auth.getState().status === 'authenticated' && calls.map((c) => c.path).join() === '/api/auth/logout,/api/auth/login');
}

{ // The queue continues after a rejection.
  browser();
  let n = 0;
  server({ '/api/auth/login': () => (++n === 1 ? json(401, { message: 'Wrong email or password.' }) : json(200, { user: B, cookie_session: true })) });
  const auth = createSomewhereAuth();
  const first = await settled(auth.signIn({ email: B.email, password: 'bad' }));
  const second = await settled(auth.signIn({ email: B.email, password: 'good' }));
  check('a failed sign-in rejects with the server message', first.error?.message === 'Wrong email or password.');
  check('the next queued sign-in still runs', second.value?.id === 'usr_b' && auth.getState().status === 'authenticated');
}

{ // A hung call is bounded and does not block the queue.
  browser({ cachedUser: A });
  const calls = server({ '/api/auth/login': (init) => hang(init), '/api/auth/logout': () => json(200, { ok: true }) });
  const auth = createSomewhereAuth({ mutationTimeoutMs: 30 });
  const signIn = settled(auth.signIn({ email: B.email, password: 'pw' }));
  const signOut = auth.signOut();
  const result = await signIn;
  await signOut;
  check('a hung sign-in rejects AUTH_TIMEOUT after mutationTimeoutMs', result.error?.code === 'AUTH_TIMEOUT', result);
  check('…and the queued signOut still reaches /logout', calls.some((c) => c.path === '/api/auth/logout'));
}

{ // A failed sign-in that invalidated the first check does not leave 'checking'.
  browser({ cachedUser: A });
  const me = deferred();
  let meCalls = 0;
  server({
    '/api/auth/me': () => (++meCalls === 1 ? me.promise : json(200, { user: A })),
    '/api/auth/login': () => json(401, { message: 'no' }),
  });
  const auth = createSomewhereAuth();
  const first = auth.getUser();
  await tick();
  await settled(auth.signIn({ email: A.email, password: 'bad' }));
  me.resolve(json(200, { user: A }));
  await first;
  for (let i = 0; i < 5 && auth.getState().status === 'checking'; i++) await tick();
  check('a failed sign-in re-checks instead of staying "checking"', auth.getState().status === 'authenticated' && meCalls === 2, { status: auth.getState().status, meCalls });
}

{ // Checks: coalesced within a generation, and queued behind sign-ins.
  browser();
  const login = deferred();
  const calls = server({ '/api/auth/me': () => json(200, { user: B }), '/api/auth/login': () => login.promise });
  const auth = createSomewhereAuth();
  const one = auth.getUser();
  const two = auth.getUser();
  check('concurrent getUser() calls share one request', one === two);
  await one;
  const signIn = auth.signIn({ email: B.email, password: 'pw' });
  const during = auth.getUser();
  await tick();
  check('a check requested during a sign-in waits for it', calls.map((c) => c.path).join() === '/api/auth/me,/api/auth/login');
  login.resolve(json(200, { user: B, cookie_session: true }));
  await signIn;
  await during;
  check('…then reads /me after the new cookies', calls.map((c) => c.path).join() === '/api/auth/me,/api/auth/login,/api/auth/me');
}

// ---------------------------------------------------------------- sign-out

for (const [label, respond, status] of [['500', () => json(500, {}), 500], ['network error', () => { throw new TypeError('x'); }, 0]]) {
  browser({ cachedUser: A });
  server({ '/api/auth/logout': respond });
  const auth = createSomewhereAuth();
  const result = await settled(auth.signOut());
  const s = auth.getState();
  check(`/logout ${label}: resolves, signed-out locally, error SIGN_OUT_UNCONFIRMED`,
    !result.error && s.status === 'signed-out' && s.error?.code === 'SIGN_OUT_UNCONFIRMED' && s.error.status === status, s);
}
{
  browser();
  const calls = server({ '/api/auth/me': () => json(401, {}) });
  const auth = createSomewhereAuth();
  await auth.getUser();
  await auth.signOut();
  check('signOut when already confirmed signed-out makes no request', calls.every((c) => c.path !== '/api/auth/logout'));
}

// ---------------------------------------------------------------- other tabs

{
  const tab = browser({ cachedUser: A });
  const calls = server({ '/api/auth/me': () => json(200, { user: tab.values.has('sw_auth_user') ? JSON.parse(tab.values.get('sw_auth_user')) : null }) });
  const auth = createSomewhereAuth();
  await auth.getUser();
  const writesBefore = tab.writes.length;
  await auth.getUser();
  check('an identical /me answer does not rewrite the cached user (no cross-tab echo)', tab.writes.length === writesBefore);
  const statuses = [];
  auth.onChange((s) => statuses.push(`${s.status}:${s.user?.id ?? null}`));
  tab.otherTab(B);
  check('another tab\'s identity is not trusted: status → checking', statuses[1] === 'checking:usr_b', statuses);
  tab.otherTab(B); // duplicate event
  await tick(); await tick();
  const meCount = calls.filter((c) => c.path === '/api/auth/me').length;
  check('…one re-check, and a duplicate event adds none', meCount === 3, meCount);
  check('…the re-check confirms B', auth.getState().status === 'authenticated' && auth.getCachedUser()?.id === 'usr_b');
  tab.otherTab({ ...B, plan: 'pro' }); // same identity, new fields
  await tick();
  check('a same-identity update from another tab is ignored (no re-check)', calls.filter((c) => c.path === '/api/auth/me').length === 3);
}

// ---------------------------------------------------------------- header mode

{
  globalThis.document = undefined;
  delete globalThis.document;
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  const api = deferred();
  server({
    '/api/x': () => api.promise,
    '/api/y': () => new Response('{}', { status: 200, headers: { 'X-New-Access-Token': 'acc2', 'X-New-Refresh-Token': 'ref2' } }),
    '/api/auth/login': () => json(200, { token: 'accB', refresh_token: 'refB', user: B }),
    '/api/auth/logout': () => json(200, {}),
  });
  values.set('sw_auth', JSON.stringify({ accessToken: 'accA', refreshToken: 'refA' }));
  const auth = createSomewhereAuth({ mode: 'header', storage });
  await auth.fetch('/api/y');
  check('header: a current-generation rotation is stored atomically', JSON.parse(values.get('sw_auth')).accessToken === 'acc2' && JSON.parse(values.get('sw_auth')).refreshToken === 'ref2');
  const stale = auth.fetch('/api/x');
  await tick();
  await auth.signIn({ email: B.email, password: 'pw' });
  api.resolve(new Response('{}', { status: 200, headers: { 'X-New-Access-Token': 'accOLD', 'X-New-Refresh-Token': 'refOLD' } }));
  await stale;
  check('header: a rotation from before the sign-in is not adopted', auth.getSession()?.accessToken === 'accB');
  const stale401 = deferred();
  server({ '/api/z': () => stale401.promise, '/api/auth/login': () => json(200, { token: 'accC', refresh_token: 'refC', user: A }) });
  const old = auth.fetch('/api/z');
  await tick();
  await auth.signIn({ email: A.email, password: 'pw' });
  stale401.resolve(json(401, {}));
  await old;
  check('header: a 401 from before the sign-in does not clear the new session', auth.getSession()?.accessToken === 'accC' && auth.getState().status === 'authenticated');
  const retried = [];
  server({ '/api/w': (init) => { retried.push(new Headers(init.headers).get('Authorization')); return json(401, {}); } });
  values.set('sw_auth', JSON.stringify({ accessToken: 'accOther', refreshToken: 'refOther' }));
  await auth.fetch('/api/w');
  check('header control: same identity 401 retries once with the freshest pair, then clears', retried.join() === 'Bearer accC,Bearer accOther' && auth.getSession() === null && auth.getState().status === 'signed-out', retried);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
