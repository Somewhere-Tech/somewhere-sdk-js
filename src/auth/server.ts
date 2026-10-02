/**
 * @somewhere-tech/sdk/server — the backend half, so the app writes ~zero auth code.
 *
 * Mount it from a single deployed function that handles your /api/auth/* routes:
 *
 *   // api/auth/[...path].ts
 *   import { somewhereAuth } from '@somewhere-tech/sdk/server';
 *   export default (req, sw) => somewhereAuth(req, sw);
 *
 * It wires the standard endpoints the @somewhere-tech/sdk/auth client talks to onto
 * `sw.auth.*` — which already owns the Google OAuth client, JWT validation, and
 * the bearer-token rotation contract. login/signup are developer-key-gated on the
 * platform (can't be called from the browser), which is exactly why this thin
 * server shim exists.
 *
 * SESSION TRANSPORT: a successful sign-in sets the session as httpOnly
 * `__Host-` cookies and answers `{ user, cookie_session: true }` — tokens
 * never reach page JS. That is the answer for every caller that does not opt
 * out, including a plain `fetch('/api/auth/login', { credentials: 'include' })`
 * with no header (pfb_e1254f754222). Only an explicit
 * `X-Sw-Auth-Mode: header` (aliases `token`, `bearer`) — a server or native
 * client that holds its own session — receives the token pair in the body, and
 * then no cookie is set. A runtime that cannot set the cookie refuses
 * (COOKIE_SESSION_UNAVAILABLE) instead of falling back to tokens.
 *
 * Covered today: email/password (signup, login, logout), magic-link/OTP,
 * Google/GitHub/Discord OAuth (url + exchange), and `me` (validate + refresh).
 */

/** The slice of the platform `sw` namespace this handler uses. */
export interface SwAuthNamespace {
  auth: {
    signup(opts: { email: string; password: string; display_name?: string }): Promise<unknown>;
    login(opts: { email: string; password: string }): Promise<unknown>;
    loginWithCookie?(req: Request, email: string, password: string): Promise<unknown>;
    signupWithCookie?(
      req: Request,
      email: string,
      password: string,
      opts?: { display_name?: string },
    ): Promise<unknown>;
    logout(opts: Record<string, unknown>): Promise<unknown>;
    fromRequest(req: Request, enrich?: unknown): Promise<unknown>;
    // The platform runtime returns the OAuth URL synchronously as a string; an
    // older async adapter may resolve a string or { url }. The handler accepts both.
    googleUrl(opts: { redirect_uri: string }): string | Promise<unknown>;
    googleExchange(opts: { code: string }): Promise<unknown>;
    githubUrl(opts: { redirect_uri: string }): string | Promise<unknown>;
    githubExchange(opts: { code: string }): Promise<unknown>;
    discordUrl(opts: { redirect_uri: string }): string | Promise<unknown>;
    discordExchange(opts: { code: string }): Promise<unknown>;
    signInWithOtp(opts: { email: string; redirect_uri?: string }): Promise<unknown>;
    verifyOtp(opts: { token: string }): Promise<unknown>;
    /** Cookie-session primitives (tsk_1dd4e1b4) — optional so the handler
     *  degrades to token bodies on runtimes that predate them. */
    setSessionCookies?(access: string, refresh: string): void;
    logoutWithCookie?(req: Request): Promise<unknown>;
  };
  /** Entitlements (sw.billing) — optional so the handler degrades cleanly on a
   *  runtime that predates it (the /plans route 404s instead of throwing). */
  billing?: {
    plans(): Promise<unknown>;
  };
  /** Payments (sw.payments) — drives the <PricingTable>/<BillingPortal> flows.
   *  Optional so the handler degrades cleanly on an older runtime. */
  payments?: {
    // The runtime derives the buyer from the request's signed-in user; it takes
    // no user id (runtime v2, 2026-08-02). The handler returns the result as-is;
    // a checkout session's url may be null.
    checkoutForUser(opts: { plan: string; success_url?: string; cancel_url?: string }): Promise<{ url?: string | null }>;
    portalForUser(opts: { return_url?: string }): Promise<{ url?: string | null }>;
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface TokenBundle {
  token?: string;
  access_token?: string;
  refresh_token?: string;
  user?: unknown;
  data?: TokenBundle;
}

/**
 * Runtime response-contract compatibility (platform tsk_72c4b4d2, A-F05).
 * Runtime 2026081605+ cookie helpers return the documented { user } envelope;
 * older baked bundles return the bare user object (or null). Accept both so
 * one SDK version serves projects on either runtime generation.
 */
function unwrapAuthUser(result: unknown): unknown {
  if (result && typeof result === 'object' && 'user' in (result as Record<string, unknown>)) {
    return (result as { user?: unknown }).user ?? null;
  }
  return result ?? null;
}

export async function somewhereAuth(req: Request, sw: SwAuthNamespace): Promise<Response> {
  const url = new URL(req.url);
  // The path after the (last) `/auth` segment — robust to whatever prefix the
  // app mounts the handler at (/api/auth, /auth, …).
  const m = url.pathname.match(/\/auth(\/[A-Za-z0-9/_-]*)?$/);
  const sub = (m && m[1]) || '/';
  const method = req.method.toUpperCase();

  // SESSION COOKIES ARE THE ONLY DEFAULT (platform tsk_d05a6cfb, pfb_e1254f754222).
  //
  // A browser must never receive the token pair: a body the page can read is
  // a session any injected script can steal. Before 0.10.0 a caller with no
  // `X-Sw-Auth-Mode` header got the cookie AND the 0.1.x token bundle in the
  // body, so a plain-fetch browser sign-in handed JS-readable tokens to the
  // page. What each caller sees now:
  //   no header, or `cookie`    — cookies + `{ user, cookie_session: true }`.
  //   `header` (or `token`/`bearer`) — the explicit opt-in for a server or
  //                               native client that holds its own session:
  //                               the token bundle, and no cookie is set.
  // An app that sets its OWN cookie is untouched either way: this handler only
  // ever adds the platform `__Host-` pair, and never reads or clears another
  // name.
  const modeHint = (req.headers.get('X-Sw-Auth-Mode') || '').toLowerCase();
  const tokenMode = modeHint === 'header' || modeHint === 'token' || modeHint === 'bearer';
  const wantsCookie = !tokenMode;
  // Optional on the namespace: an older baked runtime without it answers
  // COOKIE_SESSION_UNAVAILABLE below, never the token pair.
  const canCookie = wantsCookie && typeof sw.auth.setSessionCookies === 'function';

  // Set the httpOnly pair from a platform token bundle. Returns the unwrapped
  // bundle when the session was staged, or null when there is no pair to stage
  // (e.g. mfa_required, or an opted-out/older runtime) so the caller answers
  // with the token body.
  const stageSessionCookies = (bundle: unknown): TokenBundle | null => {
    if (!canCookie) return null;
    const b = (bundle ?? {}) as TokenBundle;
    const d = b.data ?? b;
    const access = d.token ?? d.access_token;
    const refresh = d.refresh_token;
    if (!access || !refresh) return null;
    sw.auth.setSessionCookies!(String(access), String(refresh));
    return d;
  };

  // Answer a sign-in: the token bundle only to an explicit opt-in; everyone
  // else gets the cookie handshake. A bundle with no token pair (an MFA
  // challenge) carries no session and passes through. A pair this runtime
  // cannot put in a cookie is refused, never handed to the caller.
  const sessionResponse = (bundle: unknown): Response => {
    if (tokenMode) return json(bundle);
    const staged = stageSessionCookies(bundle);
    if (staged) return json({ user: staged.user ?? null, cookie_session: true });
    const b = (bundle ?? {}) as TokenBundle;
    const d = b.data ?? b;
    if (d.token || d.access_token || d.refresh_token) {
      return json({
        error: 'COOKIE_SESSION_UNAVAILABLE',
        message: 'This deploy cannot set a session cookie, so the sign-in was not completed. Redeploy to pick up the current runtime. A server or native client that holds its own session can send X-Sw-Auth-Mode: header to receive tokens instead.',
      }, 501);
    }
    return json(bundle);
  };

  const readBody = async (): Promise<Record<string, unknown>> => {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  try {
    if (method === 'POST' && sub === '/signup') {
      const b = await readBody();
      if (wantsCookie && typeof sw.auth.signupWithCookie === 'function') {
        const result = await sw.auth.signupWithCookie(
          req,
          String(b.email ?? ''),
          String(b.password ?? ''),
          { display_name: (b.display_name ?? b.displayName) as string | undefined },
        );
        return json({ user: unwrapAuthUser(result), cookie_session: true });
      }
      const d = await sw.auth.signup({
        email: String(b.email ?? ''),
        password: String(b.password ?? ''),
        display_name: (b.display_name ?? b.displayName) as string | undefined,
      });
      return sessionResponse(d);
    }
    if (method === 'POST' && sub === '/login') {
      const b = await readBody();
      if (wantsCookie && typeof sw.auth.loginWithCookie === 'function') {
        const result = await sw.auth.loginWithCookie(
          req,
          String(b.email ?? ''),
          String(b.password ?? ''),
        );
        return json({ user: unwrapAuthUser(result), cookie_session: true });
      }
      const d = await sw.auth.login({ email: String(b.email ?? ''), password: String(b.password ?? '') });
      return sessionResponse(d);
    }
    if (method === 'POST' && sub === '/logout') {
      // logoutWithCookie revokes the session from the refresh cookie AND
      // parks the Set-Cookie expirations; harmless when no cookies exist.
      if (typeof sw.auth.logoutWithCookie === 'function') {
        try { await sw.auth.logoutWithCookie(req); } catch { /* best-effort */ }
      } else {
        try { await sw.auth.logout({}); } catch { /* best-effort */ }
      }
      return json({ ok: true });
    }
    if (method === 'GET' && sub === '/me') {
      const user = await sw.auth.fromRequest(req);
      return json({ user: user ?? null });
    }
    if (method === 'POST' && sub === '/magic-link') {
      const b = await readBody();
      const d = await sw.auth.signInWithOtp({
        email: String(b.email ?? ''),
        redirect_uri: typeof b.redirect_uri === 'string' ? b.redirect_uri : undefined,
      });
      return json(d);
    }
    if (method === 'POST' && sub === '/magic-link/verify') {
      const b = await readBody();
      const d = await sw.auth.verifyOtp({ token: String(b.token ?? '') });
      return sessionResponse(d);
    }
    // Entitlements (sw.billing): the project's plan catalog, for a pricing page.
    // The catalog is project-wide and non-secret. 404s on a runtime without
    // sw.billing so an older deploy degrades instead of throwing.
    if (method === 'GET' && sub === '/plans') {
      if (typeof sw.billing?.plans !== 'function') {
        return json({ error: 'NOT_FOUND', message: 'Entitlements are not available on this runtime.' }, 404);
      }
      const result = (await sw.billing.plans()) as { plans?: unknown };
      return json({ plans: result?.plans ?? [] });
    }
    // Start a subscription checkout for the SIGNED-IN user (<PricingTable>'s
    // Subscribe button). SECURITY: the runtime derives the buyer from the
    // request's signed-in user — NEVER a body-supplied id — so there's no IDOR
    // on a money op; fromRequest here only answers a clean 401 first. The only
    // client input is which plan slug to buy. The worker resolves that plan's
    // price from the billing catalog.
    if (method === 'POST' && sub === '/billing/checkout') {
      if (typeof sw.payments?.checkoutForUser !== 'function') {
        return json({ error: 'NOT_FOUND', message: 'Billing is not available on this runtime.' }, 404);
      }
      const me = (await sw.auth.fromRequest(req)) as { id?: string } | null;
      if (!me || !me.id) return json({ error: 'AUTH_REQUIRED', message: 'Sign in required.' }, 401);
      const b = await readBody();
      if (typeof b.plan !== 'string' || !b.plan) {
        return json({ error: 'VALIDATION_ERROR', message: 'plan is required.' }, 400);
      }
      const result = await sw.payments.checkoutForUser({
        plan: b.plan,
        success_url: typeof b.success_url === 'string' ? b.success_url : undefined,
        cancel_url: typeof b.cancel_url === 'string' ? b.cancel_url : undefined,
      });
      return json(result);
    }
    // Open the Stripe billing portal for the SIGNED-IN user (<BillingPortal>).
    // SECURITY: same as checkout — the runtime resolves this user's
    // stripe_customer_id from their session server-side; no id crosses from
    // the browser, so a user can only ever manage their OWN subscription.
    if (method === 'POST' && sub === '/billing/portal') {
      if (typeof sw.payments?.portalForUser !== 'function') {
        return json({ error: 'NOT_FOUND', message: 'Billing is not available on this runtime.' }, 404);
      }
      const me = (await sw.auth.fromRequest(req)) as { id?: string } | null;
      if (!me || !me.id) return json({ error: 'AUTH_REQUIRED', message: 'Sign in required.' }, 401);
      const b = await readBody();
      const result = await sw.payments.portalForUser({
        return_url: typeof b.return_url === 'string' ? b.return_url : undefined,
      });
      return json(result);
    }
    if (method === 'GET' && sub === '/google-url') {
      const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/auth/callback`;
      const r = (await sw.auth.googleUrl({ redirect_uri: redirectUri })) as { url?: string } | string;
      return json({ url: typeof r === 'string' ? r : r?.url });
    }
    if (method === 'POST' && sub === '/google') {
      const b = await readBody();
      const d = await sw.auth.googleExchange({ code: String(b.code ?? '') });
      return sessionResponse(d);
    }
    if (method === 'GET' && sub === '/github-url') {
      const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/auth/callback`;
      const r = (await sw.auth.githubUrl({ redirect_uri: redirectUri })) as { url?: string } | string;
      return json({ url: typeof r === 'string' ? r : r?.url });
    }
    if (method === 'POST' && sub === '/github') {
      const b = await readBody();
      const d = await sw.auth.githubExchange({ code: String(b.code ?? '') });
      return sessionResponse(d);
    }
    if (method === 'GET' && sub === '/discord-url') {
      const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/auth/callback`;
      const r = (await sw.auth.discordUrl({ redirect_uri: redirectUri })) as { url?: string } | string;
      return json({ url: typeof r === 'string' ? r : r?.url });
    }
    if (method === 'POST' && sub === '/discord') {
      const b = await readBody();
      const d = await sw.auth.discordExchange({ code: String(b.code ?? '') });
      return sessionResponse(d);
    }
    return json({ error: 'NOT_FOUND', message: `No @somewhere-tech/sdk/auth route for ${method} ${sub}` }, 404);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 400;
    return json({ error: 'AUTH_ERROR', message: (err as Error)?.message || 'Auth failed' }, status);
  }
}
