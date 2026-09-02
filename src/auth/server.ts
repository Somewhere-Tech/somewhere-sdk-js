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
 * SESSION TRANSPORT: every successful sign-in sets the session as httpOnly
 * `__Host-` cookies whenever the runtime exposes `sw.auth.setSessionCookies`,
 * so a plain `fetch('/api/auth/login', { credentials: 'include' })` — the
 * published browser happy path — persists the session with no header to
 * remember. `X-Sw-Auth-Mode` selects the RESPONSE BODY, not whether a session
 * exists: `cookie` returns only `{ user, cookie_session: true }` (tokens never
 * enter page JS), every other caller keeps the 0.1.x token-bundle body
 * unchanged, and `token` opts out of the cookie entirely for a backend that
 * mints its own. Before tsk_d05a6cfb the cookie was header-gated, so the
 * documented browser flow signed up successfully and then had no session.
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
    googleUrl(opts: { redirect_uri: string }): Promise<unknown>;
    googleExchange(opts: { code: string }): Promise<unknown>;
    githubUrl(opts: { redirect_uri: string }): Promise<unknown>;
    githubExchange(opts: { code: string }): Promise<unknown>;
    discordUrl(opts: { redirect_uri: string }): Promise<unknown>;
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
    checkoutForUser(userId: string, opts: { plan: string; success_url?: string; cancel_url?: string }): Promise<{ url?: string } & Record<string, unknown>>;
    portalForUser(userId: string, opts: { return_url?: string }): Promise<{ url?: string } & Record<string, unknown>>;
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

  // SESSION COOKIES ARE THE DEFAULT (platform tsk_d05a6cfb).
  //
  // Until now the httpOnly pair was set ONLY when the caller sent
  // `X-Sw-Auth-Mode: cookie` — which the @somewhere-tech/sdk/auth client sends
  // and a plain `fetch(..., { credentials: 'include' })` does not. So the
  // published browser happy path (AGENT.md's lead example, docs({ topic:
  // 'auth-client' }) §3) got a 200 with no `Set-Cookie` at all against the
  // scaffold's `api/auth/[...path]` route: sign-up succeeded and the session
  // never persisted. The header now selects the RESPONSE BODY, not whether a
  // session exists.
  //
  // What each caller sees after this change:
  //   `X-Sw-Auth-Mode: cookie`  — cookies + `{ user, cookie_session: true }`. Unchanged.
  //   no header (raw fetch, non-browser client, pre-0.2.0 client)
  //                             — cookies, AND the 0.1.x token bundle body,
  //                               byte-identical to what it received before.
  //                               Nothing that reads `access_token` breaks; a
  //                               client with no cookie jar ignores the header.
  //   `X-Sw-Auth-Mode: token`   — the rule-9 opt-out: no cookie is ever set.
  //                               For a backend that mints its own session
  //                               cookie from the returned tokens and does not
  //                               want the platform pair alongside it.
  // An app that sets its OWN cookie is untouched either way: this handler only
  // ever adds the platform `__Host-` pair, and never reads or clears another
  // name.
  const modeHint = (req.headers.get('X-Sw-Auth-Mode') || '').toLowerCase();
  const wantsCookie = modeHint === 'cookie';
  const refusesCookie = modeHint === 'token' || modeHint === 'bearer' || modeHint === 'header';
  // Optional on the namespace so an older baked runtime degrades to token
  // bodies instead of throwing.
  const canCookie = !refusesCookie && typeof sw.auth.setSessionCookies === 'function';

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

  // Stage the cookies, then answer in the shape this caller asked for: the
  // cookie handshake when it sent the hint, otherwise the token bundle it has
  // always received (now accompanied by a session cookie it is free to ignore).
  const sessionResponse = (bundle: unknown): Response => {
    const staged = stageSessionCookies(bundle);
    if (wantsCookie && staged) {
      return json({ user: staged.user ?? null, cookie_session: true });
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
    // Subscribe button). SECURITY: the buyer is resolved from the session via
    // fromRequest — NEVER a body-supplied id — so there's no IDOR on a money
    // op. The only client input is which plan slug to buy. The worker resolves
    // that plan's price from the billing catalog.
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
      const result = await sw.payments.checkoutForUser(me.id, {
        plan: b.plan,
        success_url: typeof b.success_url === 'string' ? b.success_url : undefined,
        cancel_url: typeof b.cancel_url === 'string' ? b.cancel_url : undefined,
      });
      return json(result);
    }
    // Open the Stripe billing portal for the SIGNED-IN user (<BillingPortal>).
    // SECURITY: same as checkout — the worker resolves this user's
    // stripe_customer_id from their session id server-side; no id crosses from
    // the browser, so a user can only ever manage their OWN subscription.
    if (method === 'POST' && sub === '/billing/portal') {
      if (typeof sw.payments?.portalForUser !== 'function') {
        return json({ error: 'NOT_FOUND', message: 'Billing is not available on this runtime.' }, 404);
      }
      const me = (await sw.auth.fromRequest(req)) as { id?: string } | null;
      if (!me || !me.id) return json({ error: 'AUTH_REQUIRED', message: 'Sign in required.' }, 401);
      const b = await readBody();
      const result = await sw.payments.portalForUser(me.id, {
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
