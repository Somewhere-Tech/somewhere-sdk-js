/**
 * @somewhere-tech/sdk/auth — framework-agnostic session client.
 *
 * ONLY-PATH CONTRACT (tsk_acd56ee8): a browser uses same-origin httpOnly
 * cookie sessions and holds zero credentials. This package is an optional UI
 * adapter over that runtime contract, not a new transport.
 *
 * Explicit header mode exists for scripts/native clients and compatibility
 * with older browser integrations. In that mode it wraps fetch so that:
 *
 *   1. Every authed request carries `Authorization: Bearer <access>` AND
 *      `X-Refresh-Token: <refresh>` (the ride-along), letting the server
 *      auto-refresh an expired access token in-band.
 *   2. When the server rotates the session it returns `X-New-Access-Token` +
 *      `X-New-Refresh-Token`; we persist the NEW PAIR ATOMICALLY (one write,
 *      both or neither). A half-write is how sessions desync.
 *   3. A network blip (fetch throws) NEVER clears the session — we re-throw
 *      and keep the tokens. Logging the user out because their wifi hiccuped
 *      is the single most common hand-rolled-auth bug.
 *   4. CROSS-TAB: when another tab rotates the session, this tab picks the
 *      new pair up off the `storage` event instead of riding its stale copy
 *      past the server's reuse-grace window (which reads as a phantom
 *      logout in every background tab). A 401 on a request that carried a
 *      since-rotated pair retries ONCE with the freshest stored pair before
 *      concluding the session is dead.
 *
 * COOKIE MODE (0.2.0+, the BROWSER DEFAULT): instead of holding tokens in
 * localStorage (XSS-exfiltratable), the backend sets the session as httpOnly
 * cookies and the browser owns it — this client stores NO tokens, sends
 * `credentials: 'include'`, and caches only the (non-secret) user object for
 * optimistic rendering. Mode is negotiated per sign-in: the client hints
 * `X-Sw-Auth-Mode: cookie`; only a server that actually set the cookies
 * replies `cookie_session: true`. An older backend that doesn't ⇒ the client
 * falls back to header mode for that session, so nothing breaks and nobody
 * is logged out. An EXISTING stored header session is adopted as-is (no
 * forced re-auth) and migrates to cookies transparently on the next login.
 *
 * The token trio originates from the app's own backend (login/signup are
 * developer-key-gated on the platform, so they can't be called from the
 * browser). Mount `somewhereAuth` from `@somewhere-tech/sdk/server` at
 * `/api/auth/*` to expose the standard endpoints this client talks to.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export type AppUserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string | null;
  /** Platform-owned app role. Optional while cached users and older servers
   *  roll forward. Use it for UI rendering only; enforce admin access
   *  server-side with sw.auth.requireUser(req, { role: 'admin' }). */
  role?: AppUserRole;
  /** The user's current plan slug (sw.billing) — e.g. 'free' | 'pro'. Use it to
   *  highlight the current plan in <PricingTable>. */
  plan?: string;
  /** Subscription status: 'active' | 'trialing' | 'canceled' | 'past_due' | null. */
  plan_status?: string | null;
  /** The feature slugs this user's plan grants (sw.billing). Hydrated from the
   *  session by the backend — `auth.billing.has(feature)` reads it with no
   *  network call. Absent on a backend that predates entitlements. */
  entitlements?: string[];
  [key: string]: unknown;
}

/** One plan from the project's code-defined catalog (sw.billing). */
export interface BillingPlan {
  slug: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  interval: string | null;
  stripe_price_id: string | null;
  sort_order: number;
  is_default: boolean;
  active: boolean;
  features: Array<{ feature: string; limit_value: number | null }>;
}

/**
 * Entitlements client (sw.billing). `has`/`entitlements` are SYNCHRONOUS local
 * checks against the current user's session — the feature list rides the user
 * object the backend already returns, so gating costs no network round-trip
 * (the Clerk-`has()` shape). `plans()` fetches the project's catalog for a
 * pricing page.
 */
export interface BillingClient {
  /** Does the current user's plan grant `feature`? Sync; false when signed out. */
  has(feature: string): boolean;
  /** The current user's granted feature slugs. Sync; [] when signed out. */
  entitlements(): string[];
  /** The project's plan catalog (network). */
  plans(): Promise<BillingPlan[]>;
  /** Start a subscription checkout for the CURRENT user and (by default) redirect
   *  the browser to Stripe. success/cancel default to the current page. The
   *  buyer is the signed-in user — resolved server-side, never passed from here. */
  subscribe(plan: string, opts?: { successUrl?: string; cancelUrl?: string; redirect?: boolean }): Promise<{ url: string }>;
  /** Open the Stripe billing portal for the CURRENT user (manage / cancel) and
   *  (by default) redirect there. return_url defaults to the current page. */
  openBillingPortal(opts?: { returnUrl?: string; redirect?: boolean }): Promise<{ url: string }>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 'cookie' — httpOnly cookie session set by the backend; no tokens in JS.
 * 'header' — compatibility/non-browser mode: Bearer + refresh ride-along
 * with tokens in `storage`. Do not select this for a new browser app.
 * Default: 'cookie' in a browser (document exists), 'header' elsewhere
 * (Node / CLI / native — where httpOnly cookies don't exist).
 */
export type AuthMode = 'cookie' | 'header';

export interface SomewhereAuthOptions {
  /** Base URL of the app's backend auth routes. Default '' (same-origin). */
  baseUrl?: string;
  /** Path prefix the backend handler is mounted at. Default '/api/auth'. */
  authPath?: string;
  /** Header-mode token storage. Unused by a cookie-native browser session. */
  storage?: StorageLike;
  /** localStorage key. Default 'sw_auth'. */
  storageKey?: string;
  /** Session transport. Default: 'cookie' in browsers, 'header' elsewhere. */
  mode?: AuthMode;
}

const ACCESS_ROTATE_HEADER = 'X-New-Access-Token';
const REFRESH_ROTATE_HEADER = 'X-New-Refresh-Token';
const RIDE_ALONG_HEADER = 'X-Refresh-Token';
// Sent on sign-in calls when this client prefers cookies; a cookie-capable
// backend answers by setting the httpOnly pair and replying
// `cookie_session: true` INSTEAD of tokens. The handshake is what makes the
// rollout dual-mode: an older backend ignores the hint, returns tokens, and
// this client silently falls back to header mode — no one gets logged out.
const MODE_HINT_HEADER = 'X-Sw-Auth-Mode';

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access can throw in sandboxed iframes */
  }
  return memoryStorage();
}

export interface SomewhereAuth {
  /** fetch wrapper that rides the session + persists rotation. Use it for
   *  every request to your backend that needs the user. */
  fetch: typeof fetch;
  signUp(input: { email: string; password: string; displayName?: string }): Promise<User>;
  signIn(input: { email: string; password: string }): Promise<User>;
  /** Send a magic-link / OTP email. The link/code completes via verifyMagicLink. */
  sendMagicLink(input: { email: string; redirectUri?: string }): Promise<void>;
  verifyMagicLink(input: { token: string }): Promise<User>;
  /** Get the platform-owned Google OAuth URL (no Google project needed). */
  googleSignInUrl(input?: { redirectUri?: string }): Promise<string>;
  /** Exchange a Google `?code=` (from the callback) for a session. */
  completeGoogleSignIn(input: { code: string }): Promise<User>;
  /** Get the platform-owned GitHub OAuth URL. */
  githubSignInUrl(input?: { redirectUri?: string }): Promise<string>;
  /** Exchange a GitHub `?code=` (from the callback) for a session. */
  completeGithubSignIn(input: { code: string }): Promise<User>;
  /** Get the platform-owned Discord OAuth URL. */
  discordSignInUrl(input?: { redirectUri?: string }): Promise<string>;
  /** Exchange a Discord `?code=` (from the callback) for a session. */
  completeDiscordSignIn(input: { code: string }): Promise<User>;
  signOut(): Promise<void>;
  /** Re-fetch the current user from the backend (validates + refreshes). */
  getUser(): Promise<User | null>;
  /** Current session from memory (no network). Always null for a cookie
   *  session — the tokens are httpOnly, deliberately unreadable from JS;
   *  use getCachedUser()/getUser() for signed-in state. */
  getSession(): Session | null;
  getCachedUser(): User | null;
  /** Subscribe to session/user changes (login, logout, rotation). */
  onChange(listener: (state: { user: User | null; session: Session | null }) => void): () => void;
  /** Entitlements (sw.billing) — `has(feature)` / `entitlements()` / `plans()`. */
  billing: BillingClient;
}

interface TokenResponse {
  token?: string;
  access_token?: string;
  refresh_token?: string;
  user?: User;
  cookie_session?: boolean;
  data?: { token?: string; access_token?: string; refresh_token?: string; user?: User; cookie_session?: boolean };
}

export function createSomewhereAuth(options: SomewhereAuthOptions = {}): SomewhereAuth {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const authPath = (options.authPath ?? '/api/auth').replace(/\/$/, '');
  const storage = options.storage ?? defaultStorage();
  const key = options.storageKey ?? 'sw_auth';
  const userKey = `${key}_user`; // cached user JSON for optimistic restore (tsk_1288e1c6)
  // ONLY-PATH CONTRACT (tsk_acd56ee8): browsers use cookie sessions and keep
  // credentials out of page JavaScript. Header mode exists only for non-browser
  // clients and rule-9 compatibility with pre-0.2.0/older-handler sessions.
  const preferCookie = options.mode ? options.mode === 'cookie' : typeof document !== 'undefined';

  let session: Session | null = loadSession();
  // Optimistic restore: seed the user from cache so a fresh page load paints
  // the signed-in UI immediately and a transient /me failure (offline, 5xx)
  // never flashes logged-out. In header mode only trust the cache when a
  // session exists — no tokens means no user, don't show a ghost. In cookie
  // mode the tokens are httpOnly (unreadable here), so the cached user IS our
  // best knowledge of the session; /me validates it in the background.
  //
  // Note: when `session` is non-null under preferCookie, this is an EXISTING
  // header-mode session from a pre-0.2.0 install. We adopt it as-is (header
  // transport) so the upgrade logs nobody out; it migrates to cookies on the
  // next sign-in.
  let user: User | null = session || preferCookie ? loadUser() : null;
  const listeners = new Set<(s: { user: User | null; session: Session | null }) => void>();

  function loadSession(): Session | null {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Session>;
      if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }
    } catch {
      /* corrupt → treat as logged out */
    }
    return null;
  }

  function loadUser(): User | null {
    try {
      const raw = storage.getItem(userKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as User;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function emit() {
    const snapshot = { user, session };
    for (const l of listeners) l(snapshot);
  }

  /** ATOMIC: persist the whole session as one value, or clear it. There is no
   *  code path that writes one token without the other. */
  function setSession(next: Session | null) {
    session = next;
    try {
      if (next) storage.setItem(key, JSON.stringify(next));
      else storage.removeItem(key);
    } catch {
      /* storage unavailable — keep the in-memory session anyway */
    }
    emit();
  }

  function setUser(next: User | null) {
    user = next;
    try {
      if (next) storage.setItem(userKey, JSON.stringify(next));
      else storage.removeItem(userKey);
    } catch {
      /* storage unavailable — keep the in-memory user anyway */
    }
    emit();
  }

  // Cross-tab sync: `storage` fires only in OTHER tabs/windows of the same
  // origin — exactly the set whose in-memory session goes stale when this
  // one rotates. Without it a background tab keeps riding its old refresh
  // token; past the server's reuse-grace window that 401s and reads as a
  // random logout (the multi-tab footgun this package exists to kill).
  // key === null means storage.clear().
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== null && e.key !== key && e.key !== userKey) return;
      session = loadSession();
      user = session || preferCookie ? loadUser() : null;
      emit();
    });
  }

  const authFetch: typeof fetch = async (input, init = {}) => {
    // Cookie path: no held tokens — the browser attaches the httpOnly pair
    // and the server refreshes it in-band (re-issued via Set-Cookie). Taken
    // only when no header session exists, so an adopted pre-0.2.0 session
    // keeps its header transport untouched.
    if (preferCookie && !session) {
      // NETWORK BLIP — if fetch throws, the request never reached the server;
      // the throw propagates and the cached user stays. A fetch failure is
      // NOT a 401.
      const res = await fetch(input, { credentials: 'include', ...init });
      // The server had the refresh cookie and still rejected: the session is
      // genuinely dead. Anything else (5xx, blip) leaves the user cached.
      if (res.status === 401 && user) setUser(null);
      return res;
    }

    const attempt = async (sess: Session | null): Promise<Response> => {
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      if (sess) {
        headers.set('Authorization', `Bearer ${sess.accessToken}`);
        headers.set(RIDE_ALONG_HEADER, sess.refreshToken);
      }
      // Clone Request inputs so a body can survive the one stale-session
      // retry below (a consumed body throws on re-send).
      const target = input instanceof Request ? input.clone() : (input as RequestInfo);
      // NETWORK BLIP — if fetch throws, the request never reached the
      // server. The throw propagates untouched; the session stays.
      return fetch(target, { ...init, headers });
    };

    // Rotation: only when BOTH new tokens are present. Atomic swap.
    const applyRotation = (res: Response) => {
      const newAccess = res.headers.get(ACCESS_ROTATE_HEADER);
      const newRefresh = res.headers.get(REFRESH_ROTATE_HEADER);
      if (newAccess && newRefresh) {
        setSession({ accessToken: newAccess, refreshToken: newRefresh });
      }
    };

    const used = session;
    let res = await attempt(used);
    applyRotation(res);

    // 401 with a since-rotated pair: another tab may have refreshed while
    // this request was in flight. Re-read storage; if a DIFFERENT session
    // is there, retry ONCE with it before giving up.
    if (res.status === 401 && used) {
      const stored = loadSession();
      if (stored && (stored.accessToken !== used.accessToken || stored.refreshToken !== used.refreshToken)) {
        setSession(stored);
        res = await attempt(stored);
        applyRotation(res);
      }
    }

    // A 401 on the freshest pair means refresh already failed server-side
    // (it had the ride-along refresh token and still couldn't mint a
    // session). The session is genuinely dead — clear it. Any other status
    // leaves it intact.
    if (res.status === 401 && session) {
      setSession(null);
      setUser(null);
    }

    return res;
  };

  function url(path: string): string {
    return `${baseUrl}${authPath}${path}`;
  }

  function pickTokens(body: TokenResponse): { access: string; refresh: string; user: User | null } | null {
    const d = body.data ?? body;
    const access = d.token ?? d.access_token;
    const refresh = d.refresh_token;
    if (!access || !refresh) return null;
    return { access, refresh, user: d.user ?? null };
  }

  async function postForSession(path: string, payload: unknown): Promise<User> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (preferCookie) headers[MODE_HINT_HEADER] = 'cookie';
    const res = await fetch(url(path), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload ?? {}),
      ...(preferCookie ? { credentials: 'include' as RequestCredentials } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; message?: string };
    if (!res.ok) {
      throw new AuthError(body.message || body.error || `Request failed (${res.status})`, res.status);
    }
    // Cookie handshake confirmed: the backend set the httpOnly pair and the
    // browser owns the session — no tokens in the body, nothing to store.
    // This is also the transparent header→cookie migration point: any legacy
    // localStorage pair from a pre-0.2.0 install is purged here.
    const d = body.data ?? body;
    if (preferCookie && (d.cookie_session === true || body.cookie_session === true)) {
      if (session) setSession(null);
      if (d.user) setUser(d.user);
      else await getUser();
      return user as User;
    }
    // COMPATIBILITY MODE: explicit non-browser header mode, or a cookie-preferring
    // client whose older backend did not confirm cookies. Rule 9 requires this
    // fallback until existing 0.1.x integrations have migrated.
    const tokens = pickTokens(body);
    if (!tokens) throw new AuthError('Auth response did not include a session.', res.status);
    setSession({ accessToken: tokens.access, refreshToken: tokens.refresh });
    if (tokens.user) setUser(tokens.user);
    else await getUser();
    return user as User;
  }

  async function getUser(): Promise<User | null> {
    if (!session && preferCookie) {
      // Cookie mode: the browser owns the session, so always probe /me with
      // credentials — even with no cached user (the cookie can outlive a
      // cleared cache). 401 or an explicit { user: null } is DEFINITIVE
      // signed-out; a blip or 5xx keeps the cached user (never logout on a
      // network error).
      try {
        const res = await fetch(url('/me'), { method: 'GET', credentials: 'include' });
        if (res.status === 401) {
          if (user) setUser(null);
          return null;
        }
        if (!res.ok) return user; // transient — keep cached user
        const body = (await res.json().catch(() => ({}))) as { user?: User; data?: { user?: User } };
        const u = body.user ?? body.data?.user ?? null;
        setUser(u);
        return u;
      } catch {
        // network blip — keep whatever we had
        return user;
      }
    }
    if (!session) {
      setUser(null);
      return null;
    }
    try {
      const res = await authFetch(url('/me'), { method: 'GET' });
      if (res.status === 401) return null; // authFetch already cleared
      if (!res.ok) return user; // transient — keep cached user
      const body = (await res.json().catch(() => ({}))) as { user?: User; data?: { user?: User } };
      const u = body.user ?? body.data?.user ?? null;
      setUser(u);
      return u;
    } catch {
      // network blip — keep whatever we had
      return user;
    }
  }

  return {
    fetch: authFetch,
    signUp: (i) => postForSession('/signup', { email: i.email, password: i.password, display_name: i.displayName }),
    signIn: (i) => postForSession('/login', { email: i.email, password: i.password }),
    sendMagicLink: async (i) => {
      const res = await fetch(url('/magic-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: i.email, redirect_uri: i.redirectUri }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new AuthError(b.message || b.error || `Could not send magic link (${res.status})`, res.status);
      }
    },
    verifyMagicLink: (i) => postForSession('/magic-link/verify', { token: i.token }),
    googleSignInUrl: async (i) => {
      const res = await fetch(url(`/google-url${i?.redirectUri ? `?redirect_uri=${encodeURIComponent(i.redirectUri)}` : ''}`));
      const b = (await res.json().catch(() => ({}))) as { url?: string; data?: { url?: string } };
      const u = b.url ?? b.data?.url;
      if (!u) throw new AuthError('Could not get the Google sign-in URL.', res.status);
      return u;
    },
    completeGoogleSignIn: (i) => postForSession('/google', { code: i.code }),
    githubSignInUrl: async (i) => {
      const res = await fetch(url(`/github-url${i?.redirectUri ? `?redirect_uri=${encodeURIComponent(i.redirectUri)}` : ''}`));
      const b = (await res.json().catch(() => ({}))) as { url?: string; data?: { url?: string } };
      const u = b.url ?? b.data?.url;
      if (!u) throw new AuthError('Could not get the GitHub sign-in URL.', res.status);
      return u;
    },
    completeGithubSignIn: (i) => postForSession('/github', { code: i.code }),
    discordSignInUrl: async (i) => {
      const res = await fetch(url(`/discord-url${i?.redirectUri ? `?redirect_uri=${encodeURIComponent(i.redirectUri)}` : ''}`));
      const b = (await res.json().catch(() => ({}))) as { url?: string; data?: { url?: string } };
      const u = b.url ?? b.data?.url;
      if (!u) throw new AuthError('Could not get the Discord sign-in URL.', res.status);
      return u;
    },
    completeDiscordSignIn: (i) => postForSession('/discord', { code: i.code }),
    signOut: async () => {
      const had = session;
      const hadUser = user;
      setSession(null);
      setUser(null);
      if (had || (preferCookie && hadUser)) {
        // Best-effort server-side revoke (and, in cookie mode, the Set-Cookie
        // expirations that actually end the browser session); never block
        // logout on the network — local state is already cleared.
        try {
          await fetch(url('/logout'), {
            method: 'POST',
            headers: had
              ? { 'Content-Type': 'application/json', Authorization: `Bearer ${had.accessToken}` }
              : { 'Content-Type': 'application/json' },
            ...(preferCookie ? { credentials: 'include' as RequestCredentials } : {}),
          });
        } catch {
          /* ignore */
        }
      }
    },
    getUser,
    getSession: () => session,
    getCachedUser: () => user,
    onChange: (listener) => {
      listeners.add(listener);
      listener({ user, session });
      return () => void listeners.delete(listener);
    },
    billing: {
      // Reads the live `user` closure binding, so it always reflects the
      // latest session (login/logout/rotation all reassign `user`).
      has: (feature) => Array.isArray(user?.entitlements) && user.entitlements.includes(feature),
      entitlements: () => (Array.isArray(user?.entitlements) ? (user.entitlements as string[]) : []),
      plans: async () => {
        const res = await authFetch(url('/plans'), { method: 'GET' });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new AuthError(b.message || b.error || `Could not load plans (${res.status})`, res.status);
        }
        const body = (await res.json().catch(() => ({}))) as { plans?: BillingPlan[]; data?: { plans?: BillingPlan[] } };
        return body.plans ?? body.data?.plans ?? [];
      },
      subscribe: async (plan, opts) => {
        const here = typeof window !== 'undefined' ? window.location.href : undefined;
        const res = await authFetch(url('/billing/checkout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan,
            success_url: opts?.successUrl ?? here,
            cancel_url: opts?.cancelUrl ?? here,
          }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new AuthError(b.message || b.error || `Could not start checkout (${res.status})`, res.status);
        }
        const body = (await res.json().catch(() => ({}))) as { url?: string; data?: { url?: string } };
        const u = body.url ?? body.data?.url;
        if (!u) throw new AuthError('Checkout did not return a URL.', res.status);
        if (opts?.redirect !== false && typeof window !== 'undefined') window.location.assign(u);
        return { url: u };
      },
      openBillingPortal: async (opts) => {
        const here = typeof window !== 'undefined' ? window.location.href : undefined;
        const res = await authFetch(url('/billing/portal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ return_url: opts?.returnUrl ?? here }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new AuthError(b.message || b.error || `Could not open the billing portal (${res.status})`, res.status);
        }
        const body = (await res.json().catch(() => ({}))) as { url?: string; data?: { url?: string } };
        const u = body.url ?? body.data?.url;
        if (!u) throw new AuthError('Billing portal did not return a URL.', res.status);
        if (opts?.redirect !== false && typeof window !== 'undefined') window.location.assign(u);
        return { url: u };
      },
    },
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
