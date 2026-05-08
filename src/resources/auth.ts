import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { AuthResponse, Result, Session, User } from '../types.js';

/**
 * Supabase Auth-style client.
 *
 *     const { data, error } = await sw.auth.signUp({ email, password })
 *     const { data, error } = await sw.auth.signInWithPassword({ email, password })
 *     const { data, error } = await sw.auth.signOut()
 *     const { data: { user } } = await sw.auth.getUser()
 *
 * Method names match `@supabase/supabase-js` for the supported subset.
 * On successful `signUp` / `signInWithPassword` the SDK automatically
 * swaps its in-memory auth header to the returned access token, so
 * subsequent calls (db, storage, chat, emails) run with the user's
 * JWT and are scoped to their session.
 */
export class AuthClient {
  private currentSession: Session | null = null;

  constructor(private readonly client: Client) {}

  /* ─── Sign up / in / out ───────────────────────────────────── */

  async signUp(credentials: {
    email: string;
    password: string;
  }): Promise<Result<AuthResponse>> {
    return this.runAuthFlow('POST', '/auth/signup', {
      email: credentials.email,
      password: credentials.password,
    });
  }

  async signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<Result<AuthResponse>> {
    return this.runAuthFlow('POST', '/auth/login', {
      email: credentials.email,
      password: credentials.password,
    });
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
    const redirect = options.redirectTo ?? '';
    const url =
      `${this.client.baseUrl}/auth/google?project_id=${encodeURIComponent(projectId)}` +
      (redirect ? `&redirect_uri=${encodeURIComponent(redirect)}` : '');
    return { data: { provider: 'google', url }, error: null, status: 200 };
  }

  async signOut(): Promise<Result<null>> {
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
      return { data: null, error: null, status: 200 };
    } catch (err) {
      this.currentSession = null;
      this.client.clearSession();
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }

  /* ─── Session / user ────────────────────────────────────────── */

  /** Returns the current session held in SDK memory — never makes an HTTP call. */
  async getSession(): Promise<Result<{ session: Session | null }>> {
    return { data: { session: this.currentSession }, error: null, status: 200 };
  }

  /** Fetch the current user from `GET /v1/auth/me`. */
  async getUser(): Promise<Result<{ user: User | null }>> {
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
    try {
      const result = await this.client.call<{ user: User }>('PATCH', '/auth/users/me', {
        auth: 'session',
        body: { display_name: attrs.display_name, metadata: attrs.metadata },
      });
      if (this.currentSession) {
        this.currentSession = { ...this.currentSession, user: result.user };
      }
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
    try {
      const body: Record<string, unknown> = { new_password: params.newPassword };
      if (params.currentPassword !== undefined) body.current_password = params.currentPassword;
      await this.client.call('POST', '/auth/update-password', { auth: 'session', body });
      this.currentSession = null;
      this.client.clearSession();
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
    try {
      await this.client.call('DELETE', '/auth/users/me', { auth: 'session' });
      this.currentSession = null;
      this.client.clearSession();
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
  async verifyOtp(params: {
    token: string;
    newPassword: string;
  }): Promise<Result<{ reset: true }>> {
    const projectId = this.client.requireProjectId(undefined, 'auth.verifyOtp');
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

  /* ─── Internal ────────────────────────────────────────────── */

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
      const session: Session = {
        access_token: result.access_token ?? result.token,
        refresh_token: result.refresh_token,
        session_token: result.session_token,
        expires_in: result.expires_in,
        user: result.user,
      };
      this.currentSession = session;
      this.client.setSessionToken(session.access_token);
      return { data: { user: result.user, session }, error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: { user: null, session: null }, error: err, status: err.statusCode };
      }
      throw err;
    }
  }
}
