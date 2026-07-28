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
 * SESSION TRANSPORT (0.2.0): when the client sends `X-Sw-Auth-Mode: cookie`
 * (the browser default) and the runtime exposes `sw.auth.setSessionCookies`,
 * sign-in responses set the session as httpOnly cookies and return only
 * `{ user, cookie_session: true }` — the tokens never enter page JS. Every
 * other caller (non-browser clients, older clients, explicit compatibility
 * mode, older runtimes) gets the 0.1.x token-bundle body unchanged. This is a
 * rule-9 migration bridge, not a second recommended browser architecture.
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

export async function somewhereAuth(req: Request, sw: SwAuthNamespace): Promise<Response> {
  const url = new URL(req.url);
  // The path after the (last) `/auth` segment — robust to whatever prefix the
  // app mounts the handler at (/api/auth, /auth, …).
  const m = url.pathname.match(/\/auth(\/[A-Za-z0-9/_-]*)?$/);
  const sub = (m && m[1]) || '/';
  const method = req.method.toUpperCase();

  // Cookie sessions only when the CLIENT asked for them AND the runtime can
  // mint them. Falling through to the token body is compatibility for
  // non-browser/older clients and runtimes; new browser apps stay cookie-only.
  const wantsCookie = (req.headers.get('X-Sw-Auth-Mode') || '').toLowerCase() === 'cookie';
  const canCookie = typeof sw.auth.setSessionCookies === 'function';

  // Set the httpOnly pair from a platform token bundle and answer with the
  // cookie-handshake shape (user only — tokens stay out of page JS). Returns
  // null when the bundle has no pair (e.g. mfa_required) so the caller falls
  // back to the token body.
  const cookieSession = (bundle: unknown): Response | null => {
    const b = (bundle ?? {}) as TokenBundle;
    const d = b.data ?? b;
    const access = d.token ?? d.access_token;
    const refresh = d.refresh_token;
    if (!access || !refresh) return null;
    sw.auth.setSessionCookies!(String(access), String(refresh));
    return json({ user: d.user ?? null, cookie_session: true });
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
        const user = await sw.auth.signupWithCookie(
          req,
          String(b.email ?? ''),
          String(b.password ?? ''),
          { display_name: (b.display_name ?? b.displayName) as string | undefined },
        );
        return json({ user: user ?? null, cookie_session: true });
      }
      const d = await sw.auth.signup({
        email: String(b.email ?? ''),
        password: String(b.password ?? ''),
        display_name: (b.display_name ?? b.displayName) as string | undefined,
      });
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
    }
    if (method === 'POST' && sub === '/login') {
      const b = await readBody();
      if (wantsCookie && typeof sw.auth.loginWithCookie === 'function') {
        const user = await sw.auth.loginWithCookie(
          req,
          String(b.email ?? ''),
          String(b.password ?? ''),
        );
        return json({ user: user ?? null, cookie_session: true });
      }
      const d = await sw.auth.login({ email: String(b.email ?? ''), password: String(b.password ?? '') });
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
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
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
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
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
    }
    if (method === 'GET' && sub === '/github-url') {
      const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/auth/callback`;
      const r = (await sw.auth.githubUrl({ redirect_uri: redirectUri })) as { url?: string } | string;
      return json({ url: typeof r === 'string' ? r : r?.url });
    }
    if (method === 'POST' && sub === '/github') {
      const b = await readBody();
      const d = await sw.auth.githubExchange({ code: String(b.code ?? '') });
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
    }
    if (method === 'GET' && sub === '/discord-url') {
      const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/auth/callback`;
      const r = (await sw.auth.discordUrl({ redirect_uri: redirectUri })) as { url?: string } | string;
      return json({ url: typeof r === 'string' ? r : r?.url });
    }
    if (method === 'POST' && sub === '/discord') {
      const b = await readBody();
      const d = await sw.auth.discordExchange({ code: String(b.code ?? '') });
      if (wantsCookie && canCookie) {
        const r = cookieSession(d);
        if (r) return r;
      }
      return json(d);
    }
    return json({ error: 'NOT_FOUND', message: `No @somewhere-tech/sdk/auth route for ${method} ${sub}` }, 404);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 400;
    return json({ error: 'AUTH_ERROR', message: (err as Error)?.message || 'Auth failed' }, status);
  }
}
