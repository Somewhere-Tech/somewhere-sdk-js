import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type {
  AuthChangeEvent,
  AuthResponse,
  AuthSubscription,
  Result,
  Session,
  User,
} from '../types.js';

/**
 * Supabase Auth-style client.
 *
 *     const { data, error } = await sw.auth.signUp({ email, password })
 *     const { data, error } = await sw.auth.signInWithPassword({ email, password })
 *     const { data, error } = await sw.auth.signOut()
 *     const { data: { user } } = await sw.auth.getUser()
 *
 * Method names match `@supabase/supabase-js` for the supported subset.
 *
 * ONLY-PATH CONTRACT (tsk_acd56ee8):
 *
 * - COOKIE (the browser default, 0.6.0): sign-in posts to your app's own
 *   backend auth routes (`authPath`, default '/api/auth' — the standard
 *   `sw.auth.loginWithCookie` handler), which set the session as httpOnly
 *   cookies. The SDK holds NO tokens — nothing in localStorage, nothing XSS
 *   can read; it caches only the (non-secret) user object for optimistic
 *   rendering, and a network blip / 5xx NEVER reads as a logout. The server
 *   refreshes the cookie in-band on every request, so there is no client
 *   refresh logic at all.
 *
 * - HEADER (Node/CLI/native, or `authMode: 'header'`): compatibility/non-browser
 *   behavior retained under rule 9.
 *   On successful `signUp` / `signInWithPassword` the SDK swaps its
 *   in-memory auth header to the returned access token, so subsequent calls
 *   (db, storage, chat, emails) run with the user's JWT. The caller owns
 *   persistence — this is the manual/advanced mode.
 *
 * Compatibility bridge: a cookie-preferring client whose backend replies with tokens
 * (an older/manual handler) falls back to header mode for that session, and
 * an explicitly adopted header session (`setSession`) keeps header
 * transport — nobody gets logged out by the default flip.
 */
/** localStorage key for the cached (non-secret) user object in cookie mode.
 *  Shared with @somewhere-tech/auth so the two clients hand off cleanly. */
const USER_CACHE_KEY = 'sw_auth_user';

function loadCachedUser(): User | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(USER_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as User) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export class AuthClient {
  private currentSession: Session | null = null;
  /**
   * Cookie mode's only client-side state: the last-known user object.
   * NOT a credential — the session itself lives in httpOnly cookies the
   * page can't read. Cached (localStorage when available) so a reload
   * paints the signed-in UI immediately; `/me` validates in the background.
   */
  private cookieUser: User | null = null;
  private readonly authListeners = new Set<
    (event: AuthChangeEvent, session: Session | null) => void
  >();

  constructor(private readonly client: Client) {
    if (client.authMode === 'cookie') this.cookieUser = loadCachedUser();
  }

  /**
   * Cookie transport applies only while no header session is held — an
   * adopted token session (setSession / a tokens-returning backend) keeps
   * header transport untouched for its lifetime.
   */
  private get cookieMode(): boolean {
    return this.client.authMode === 'cookie' && this.currentSession === null;
  }

  /** The synthetic Session a cookie session presents: user, no readable tokens. */
  private cookieSession(): Session | null {
    return this.cookieUser ? { cookie_session: true, user: this.cookieUser } : null;
  }

  private setCookieUser(next: User | null): void {
    this.cookieUser = next;
    try {
      if (typeof localStorage === 'undefined') return;
      if (next) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(next));
      else localStorage.removeItem(USER_CACHE_KEY);
    } catch {
      /* storage unavailable — the in-memory copy still works */
    }
  }

  /* ─── Auth state changes (Supabase-compatible) ─────────────── */

  /**
   * Subscribe to sign-in / sign-out / token-refresh / user-update events.
   * Matches `@supabase/supabase-js` — the callback fires immediately with
   * `('INITIAL_SESSION', currentSession)` (asynchronously), then on every
   * later transition.
   *
   *     const { data: { subscription } } =
   *       sw.auth.onAuthStateChange((event, session) => { ... })
   *     // later: subscription.unsubscribe()
   */
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ): AuthSubscription {
    this.authListeners.add(callback);
    // Supabase fires INITIAL_SESSION asynchronously after subscribe.
    const fire = () => {
      try {
        callback('INITIAL_SESSION', this.currentSession ?? this.cookieSession());
      } catch {
        /* listener threw — never let it break the caller */
      }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(fire);
    else Promise.resolve().then(fire);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.authListeners.delete(callback);
          },
        },
      },
    };
  }

  private emit(event: AuthChangeEvent): void {
    const session = this.currentSession ?? this.cookieSession();
    for (const listener of this.authListeners) {
      try {
        listener(event, session);
      } catch {
        /* listener threw — isolate it */
      }
    }
  }

  /* ─── Sign up / in / out ───────────────────────────────────── */

  async signUp(credentials: {
    email: string;
    password: string;
  }): Promise<Result<AuthResponse>> {
    if (this.cookieMode) return this.runCookieSessionFlow('/signup', credentials);
    return this.runAuthFlow('POST', '/auth/signup', {
      email: credentials.email,
      password: credentials.password,
    });
  }

  async signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<Result<AuthResponse>> {
    if (this.cookieMode) return this.runCookieSessionFlow('/login', credentials);
    return this.runAuthFlow('POST', '/auth/login', {
      email: credentials.email,
      password: credentials.password,
    });
  }

  /** @somewhere-tech/auth-compatible alias. Result semantics stay SDK-shaped. */
  async signIn(credentials: {
    email: string;
    password: string;
  }): Promise<Result<AuthResponse>> {
    return this.signInWithPassword(credentials);
  }

  /** Send a passwordless magic-link/OTP email through the shared auth contract. */
  async sendMagicLink(input: {
    email: string;
    redirectUri?: string;
  }): Promise<Result<{ sent: true }>> {
    if (this.cookieMode) {
      return this.runCookieAction('/magic-link', {
        email: input.email,
        redirect_uri: input.redirectUri,
      });
    }
    const projectId = this.client.requireProjectId(undefined, 'auth.sendMagicLink');
    try {
      await this.client.call('POST', '/auth/magic-link', {
        auth: 'developer',
        body: {
          project_id: projectId,
          email: input.email,
          redirect_uri: input.redirectUri,
        },
      });
      return { data: { sent: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Complete passwordless sign-in; distinct from the legacy password-reset verifyOtp alias. */
  async verifyMagicLink(input: { token: string }): Promise<Result<AuthResponse>> {
    if (this.cookieMode) {
      return this.runCookieSessionFlow('/magic-link/verify', { token: input.token });
    }
    return this.runAuthFlow('POST', '/auth/magic-link/verify', { token: input.token });
  }

  /**
   * Returns a Google OAuth redirect URL. Matches Supabase's
   * `signInWithOAuth`, but note the platform currently only supports
   * Google. The caller redirects the browser to `data.url`.
   */
  async signInWithOAuth(options: {
    provider: 'google';
    redirectTo?: string;
  }): Promise<Result<{ provider: 'google'; url: string }>> {
    if (options.provider !== 'google') {
      return {
        data: null,
        error: new SomewhereError({
          code: 'UNSUPPORTED_FEATURE',
          message: `Provider ${options.provider} is not supported. Use 'google'.`,
          statusCode: 400,
          retry: false,
          retryAfterMs: null,
        }),
        status: 400,
      };
    }
    const projectId = this.client.requireProjectId(undefined, 'auth.signInWithOAuth');
    // Cookie mode's zero-code OAuth return: default the redirect to the
    // backend handler's /callback route, which exchanges the ?code, sets the
    // httpOnly cookies, and 302s home (sw.auth.googleCallbackWithCookie).
    // The page never touches a token.
    const cookieCallback =
      this.cookieMode && typeof location !== 'undefined'
        ? location.origin + this.client.authPath + '/callback'
        : '';
    const redirect = options.redirectTo ?? cookieCallback;
    const url =
      `${this.client.baseUrl}/auth/google?project_id=${encodeURIComponent(projectId)}` +
      (redirect ? `&redirect_uri=${encodeURIComponent(redirect)}` : '');
    return { data: { provider: 'google', url }, error: null, status: 200 };
  }

  async signOut(): Promise<Result<null>> {
    if (this.cookieMode) {
      const had = this.cookieUser !== null;
      this.setCookieUser(null);
      // Best-effort server-side revoke + the Set-Cookie expirations that end
      // the browser session. Never block logout on the network — local state
      // is already cleared.
      try {
        await this.client.rawFetch(this.client.authPath + '/logout', {
          method: 'POST',
          credentials: 'include',
        } as RequestInit);
      } catch {
        /* ignore */
      }
      if (had) this.emit('SIGNED_OUT');
      return { data: null, error: null, status: 200 };
    }
    const sessionToken = this.currentSession?.session_token;
    try {
      if (sessionToken) {
        const projectId = this.client.requireProjectId(undefined, 'auth.signOut');
        await this.client.call('POST', '/auth/logout', {
          auth: 'developer',
          body: { project_id: projectId, session_token: sessionToken },
        });
      }
      this.currentSession = null;
      this.client.clearSession();
      this.emit('SIGNED_OUT');
      return { data: null, error: null, status: 200 };
    } catch (err) {
      this.currentSession = null;
      this.client.clearSession();
      this.emit('SIGNED_OUT');
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /* ─── Session / user ────────────────────────────────────────── */

  /**
   * Returns the current session held in SDK memory — never makes an HTTP
   * call. In cookie mode the session is the httpOnly cookie the browser
   * owns: the returned Session has `cookie_session: true`, the cached user,
   * and deliberately NO readable tokens. Call `getUser()` to validate it
   * against the server.
   */
  async getSession(): Promise<Result<{ session: Session | null }>> {
    if (this.cookieMode) {
      return { data: { session: this.cookieSession() }, error: null, status: 200 };
    }
    return { data: { session: this.currentSession }, error: null, status: 200 };
  }

  /** Fetch the current user — `GET /v1/auth/me` (header mode) or the app's own `/me` route (cookie mode). */
  async getUser(): Promise<Result<{ user: User | null }>> {
    if (this.cookieMode) {
      // The browser owns the session, so always probe with credentials —
      // the cookie can outlive a cleared cache. A 401 (or explicit null
      // user) is DEFINITIVE signed-out; a blip or 5xx keeps the cached user
      // — a wifi hiccup must never read as a logout.
      try {
        const res = await this.client.rawFetch(this.client.authPath + '/me', {
          method: 'GET',
          credentials: 'include',
        } as RequestInit);
        if (res.status === 401) {
          if (this.cookieUser) {
            this.setCookieUser(null);
            this.emit('SIGNED_OUT');
          }
          return { data: { user: null }, error: null, status: 401 };
        }
        if (!res.ok) return { data: { user: this.cookieUser }, error: null, status: res.status };
        const body = (await res.json().catch(() => null)) as
          | { user?: User | null; data?: { user?: User | null } }
          | null;
        const u = body?.user ?? body?.data?.user ?? null;
        const hadUser = this.cookieUser !== null;
        this.setCookieUser(u);
        if (!u && hadUser) this.emit('SIGNED_OUT');
        return { data: { user: u }, error: null, status: 200 };
      } catch {
        // network blip — keep whatever we had
        return { data: { user: this.cookieUser }, error: null, status: 0 };
      }
    }
    try {
      const result = await this.client.call<{ user: User }>('GET', '/auth/me');
      return {
        data: { user: result.user },
        error: null,
        status: 200,
      };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: { user: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /**
   * Restore a session the caller stored themselves (e.g. in localStorage).
   * This flips the SDK's auth header to the supplied `access_token` so
   * subsequent calls run as that user.
   */
  async setSession(session: {
    access_token: string;
    session_token?: string;
  }): Promise<Result<{ session: Session | null }>> {
    this.client.setSessionToken(session.access_token);
    try {
      const result = await this.client.call<{ user: User }>('GET', '/auth/me');
      const fullSession: Session = {
        access_token: session.access_token,
        session_token: session.session_token,
        user: result.user,
      };
      this.currentSession = fullSession;
      this.emit('SIGNED_IN');
      return { data: { session: fullSession }, error: null, status: 200 };
    } catch (err) {
      this.client.clearSession();
      this.currentSession = null;
      if (err instanceof SomewhereError) {
        return { data: { session: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Patch the currently-signed-in user's profile (display name, metadata). */
  async updateUser(attrs: {
    display_name?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Result<{ user: User | null }>> {
    const blocked = this.cookieModeNeedsBackend<{ user: User | null }>('updateUser');
    if (blocked) return blocked;
    try {
      const result = await this.client.call<{ user: User }>('PATCH', '/auth/users/me', {
        auth: 'session',
        body: { display_name: attrs.display_name, metadata: attrs.metadata },
      });
      if (this.currentSession) {
        this.currentSession = { ...this.currentSession, user: result.user };
      }
      this.emit('USER_UPDATED');
      return { data: { user: result.user }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: { user: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /**
   * Exchange a refresh token for a fresh `(access_token, refresh_token)` pair.
   * Refresh tokens rotate — the old one is invalidated. Run this from your
   * server, not browser code (the developer key is required).
   */
  async refreshSession(refreshToken?: string): Promise<Result<{ session: Session | null }>> {
    if (this.cookieMode && refreshToken === undefined) {
      // Cookie sessions refresh server-side in-band (fromRequest re-issues
      // the cookie on every authed request) — there is no client-held pair
      // to rotate. Probe /me so the call still answers "is the session
      // alive?" with a fresh user.
      const probe = await this.getUser();
      const session = probe.data?.user ? this.cookieSession() : null;
      if (session) this.emit('TOKEN_REFRESHED');
      return { data: { session }, error: null, status: session ? 200 : 401 };
    }
    const projectId = this.client.requireProjectId(undefined, 'auth.refreshSession');
    const token = refreshToken ?? this.currentSession?.refresh_token;
    if (!token) {
      return {
        data: { session: null },
        error: new SomewhereError({
          code: 'VALIDATION_ERROR',
          message: 'No refresh_token in current session and none supplied.',
          statusCode: 400,
          retry: false,
          retryAfterMs: null,
        }),
        status: 400,
      };
    }
    try {
      const result = await this.client.call<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      }>('POST', '/auth/refresh', {
        auth: 'developer',
        body: { project_id: projectId, refresh_token: token },
      });
      this.client.setSessionToken(result.access_token);
      // Re-fetch the user to keep the session shape consistent.
      const me = await this.client.call<{ user: User }>('GET', '/auth/me');
      const session: Session = {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_in: result.expires_in,
        session_token: this.currentSession?.session_token,
        user: me.user,
      };
      this.currentSession = session;
      this.emit('TOKEN_REFRESHED');
      return { data: { session }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: { session: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /**
   * Change the password for the currently signed-in user. Pass
   * `currentPassword` unless the user has never set one (e.g. signed up
   * via Google). On success the platform wipes every session and refresh
   * token for the user — they will need to log in again everywhere.
   */
  async updatePassword(params: {
    newPassword: string;
    currentPassword?: string;
  }): Promise<Result<{ updated: true }>> {
    const blocked = this.cookieModeNeedsBackend<{ updated: true }>('updatePassword');
    if (blocked) return blocked;
    try {
      const body: Record<string, unknown> = { new_password: params.newPassword };
      if (params.currentPassword !== undefined) body.current_password = params.currentPassword;
      await this.client.call('POST', '/auth/update-password', { auth: 'session', body });
      this.currentSession = null;
      this.client.clearSession();
      this.emit('SIGNED_OUT');
      return { data: { updated: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Send the logged-in user a 6-digit email verification code. */
  async resendVerification(): Promise<Result<{ sent: true }>> {
    const blocked = this.cookieModeNeedsBackend<{ sent: true }>('resendVerification');
    if (blocked) return blocked;
    try {
      await this.client.call('POST', '/auth/resend-verification', { auth: 'session', body: {} });
      return { data: { sent: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Verify the 6-digit code that was emailed to the user. */
  async verifyEmail(code: string): Promise<Result<{ verified: true }>> {
    const blocked = this.cookieModeNeedsBackend<{ verified: true }>('verifyEmail');
    if (blocked) return blocked;
    try {
      await this.client.call('POST', '/auth/verify-email', { auth: 'session', body: { code } });
      return { data: { verified: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /**
   * Permanently delete the currently signed-in user. Wipes app_users
   * row + sessions + refresh tokens + pending resets/verifications.
   * App-level data your project stored about them is NOT touched —
   * call your own cleanup before this.
   */
  async deleteAccount(): Promise<Result<{ deleted: true }>> {
    const blocked = this.cookieModeNeedsBackend<{ deleted: true }>('deleteAccount');
    if (blocked) return blocked;
    try {
      await this.client.call('DELETE', '/auth/users/me', { auth: 'session' });
      this.currentSession = null;
      this.client.clearSession();
      this.emit('SIGNED_OUT');
      return { data: { deleted: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Trigger a password-reset email. */
  async resetPasswordForEmail(email: string): Promise<Result<{ sent: true }>> {
    const projectId = this.client.requireProjectId(undefined, 'auth.resetPasswordForEmail');
    try {
      await this.client.call('POST', '/auth/forgot', {
        auth: 'developer',
        body: { project_id: projectId, email },
      });
      return { data: { sent: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /** Complete a password reset using the token from the email. */
  async verifyPasswordReset(params: {
    token: string;
    newPassword: string;
  }): Promise<Result<{ reset: true }>> {
    const projectId = this.client.requireProjectId(undefined, 'auth.verifyPasswordReset');
    try {
      await this.client.call('POST', '/auth/reset', {
        auth: 'developer',
        body: {
          project_id: projectId,
          token: params.token,
          new_password: params.newPassword,
        },
      });
      return { data: { reset: true }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /**
   * @deprecated This historical name verifies a password-reset token, not a
   * magic-link/OTP sign-in. Use `verifyPasswordReset`; use `verifyMagicLink`
   * for passwordless sign-in. Kept unchanged under rule 9.
   */
  async verifyOtp(params: {
    token: string;
    newPassword: string;
  }): Promise<Result<{ reset: true }>> {
    return this.verifyPasswordReset(params);
  }

  /* ─── Internal ────────────────────────────────────────────── */

  /**
   * Cookie-mode sign-in/up: POST to the app's own backend route (same
   * origin), which calls `sw.auth.loginWithCookie` / `signupWithCookie`
   * server-side and sets the httpOnly pair on the response. Never throws —
   * expected failures (wrong password, duplicate email) come back as a
   * `Result` error with the server's real code + message.
   */
  private async runCookieSessionFlow(
    path: '/login' | '/signup' | '/magic-link/verify',
    payload: Record<string, unknown>,
  ): Promise<Result<AuthResponse>> {
    let res: Response;
    try {
      res = await this.client.rawFetch(this.client.authPath + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Shared with @somewhere-tech/auth/server. Raw *WithCookie handlers
          // ignore it; the adapter uses it to withhold tokens from the body.
          'X-Sw-Auth-Mode': 'cookie',
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      } as RequestInit);
    } catch (err) {
      // NETWORK BLIP — the request never reached the server. Not a logout,
      // not a credential failure; surface it as retryable.
      return {
        data: { user: null, session: null },
        error: new SomewhereError({
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Network error reaching your auth route.',
          statusCode: 0,
          retry: true,
          retryAfterMs: null,
        }),
        status: 0,
      };
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const d = (
      body && typeof body === 'object' && body.data && typeof body.data === 'object'
        ? body.data
        : body
    ) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        data: { user: null, session: null },
        error: new SomewhereError({
          code: (d?.error as string) ?? 'AUTH_ERROR',
          message: (d?.message as string) ?? `Auth request failed (${res.status}).`,
          statusCode: res.status,
          retry: res.status >= 500,
          retryAfterMs: null,
          body,
        }),
        status: res.status,
      };
    }
    // The standard cookie handler returns the bare user object; also accept
    // a { user } wrapper.
    let user = (d?.user ?? (d && typeof d.id === 'string' ? d : null)) as User | null;
    // Dual-mode fallback: a backend that replies with tokens (an older or
    // manual handler) didn't set cookies — adopt the pair as a header
    // session so sign-in still works exactly as 0.5.x.
    const access = (d?.token ?? d?.access_token) as string | undefined;
    if (access) {
      this.client.setSessionToken(access);
      if (!user) {
        try {
          const me = await this.client.call<{ user: User }>('GET', '/auth/me');
          user = me.user;
        } catch {
          user = null;
        }
      }
      const session: Session = {
        access_token: access,
        refresh_token: d?.refresh_token as string | undefined,
        session_token: d?.session_token as string | undefined,
        expires_in: d?.expires_in as number | undefined,
        user: user as User,
      };
      this.currentSession = session;
      this.emit('SIGNED_IN');
      return { data: { user, session }, error: null, status: 200 };
    }
    // Cookie session established. If the handler didn't echo the user,
    // fetch it through the cookie that was just set.
    if (!user) {
      const probe = await this.getUser();
      user = probe.data?.user ?? null;
    }
    this.setCookieUser(user);
    this.emit('SIGNED_IN');
    return { data: { user, session: this.cookieSession() }, error: null, status: 200 };
  }

  /** Cookie-mode action that does not itself establish a session. */
  private async runCookieAction(
    path: '/magic-link',
    body: Record<string, unknown>,
  ): Promise<Result<{ sent: true }>> {
    try {
      const res = await this.client.rawFetch(this.client.authPath + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Sw-Auth-Mode': 'cookie',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      } as RequestInit);
      const responseBody = (await res.json().catch(() => null)) as
        | { error?: string; message?: string; data?: { error?: string; message?: string } }
        | null;
      if (!res.ok) {
        const detail = responseBody?.data ?? responseBody;
        return {
          data: null,
          error: new SomewhereError({
            code: detail?.error ?? 'AUTH_ERROR',
            message: detail?.message ?? `Auth request failed (${res.status}).`,
            statusCode: res.status,
            retry: res.status >= 500,
            retryAfterMs: null,
            body: responseBody,
          }),
          status: res.status,
        };
      }
      return { data: { sent: true }, error: null, status: res.status };
    } catch (err) {
      return {
        data: null,
        error: new SomewhereError({
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Network error reaching your auth route.',
          statusCode: 0,
          retry: true,
          retryAfterMs: null,
        }),
        status: 0,
      };
    }
  }

  /**
   * The platform's user-profile endpoints authenticate with a Bearer JWT the
   * cookie client deliberately doesn't have (the session is an httpOnly
   * cookie scoped to YOUR app's backend, not the platform API). Teach the
   * fix instead of failing with a misleading "sign in first".
   */
  private cookieModeNeedsBackend<T>(method: string): Result<T> | null {
    if (!this.cookieMode || this.client.hasSession) return null;
    return {
      data: null,
      error: new SomewhereError({
        code: 'COOKIE_MODE_BACKEND_ROUTE_REQUIRED',
        message:
          `auth.${method} can't run from the browser in cookie mode — the session ` +
          `lives in httpOnly cookies that only your app's backend can use. Add a ` +
          `backend route that calls the matching sw.auth.* method server-side ` +
          `(see platform_help('auth-client')), or create the client with ` +
          `{ authMode: 'header' } for manual token control.`,
        statusCode: 400,
        retry: false,
        retryAfterMs: null,
      }),
      status: 400,
    };
  }

  private async runAuthFlow(
    method: 'POST',
    path: string,
    body: Record<string, unknown>,
  ): Promise<Result<AuthResponse>> {
    const projectId = this.client.requireProjectId(undefined, `auth${path}`);
    try {
      const result = await this.client.call<{
        user: User;
        token: string;
        access_token?: string;
        refresh_token?: string;
        session_token?: string;
        expires_in?: number;
      }>(method, path, {
        auth: 'developer',
        body: { ...body, project_id: projectId },
      });
      const access = result.access_token ?? result.token;
      const session: Session = {
        access_token: access,
        refresh_token: result.refresh_token,
        session_token: result.session_token,
        expires_in: result.expires_in,
        user: result.user,
      };
      this.currentSession = session;
      this.client.setSessionToken(access);
      this.emit('SIGNED_IN');
      return { data: { user: result.user, session }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: { user: null, session: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }
}
