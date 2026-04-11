import type { Client } from '../client.js';
import type { AppUser, AuthLoginResult } from '../types.js';

export interface AuthUsersQuery {
  search?: string;
  limit?: number;
  cursor?: string;
  ids?: string[];
}

export interface AuthUpdateMeInput {
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export class AuthResource {
  constructor(private readonly client: Client) {}

  signup(
    email: string,
    password: string,
    projectId?: string,
  ): Promise<AuthLoginResult> {
    const pid = this.requireProjectId(projectId);
    return this.client.call<AuthLoginResult>('POST', '/auth/signup', {
      body: { project_id: pid, email, password },
    });
  }

  login(
    email: string,
    password: string,
    projectId?: string,
  ): Promise<AuthLoginResult> {
    const pid = this.requireProjectId(projectId);
    return this.client.call<AuthLoginResult>('POST', '/auth/login', {
      body: { project_id: pid, email, password },
    });
  }

  logout(
    sessionToken: string,
    projectId?: string,
  ): Promise<{ logged_out: true }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', '/auth/logout', {
      body: { project_id: pid, session_token: sessionToken },
    });
  }

  /**
   * `jwt` is ignored at the transport level — the SDK sends whatever auth
   * the client was constructed with. Pass it only if you want to call `me`
   * from a developer-key client against a specific end-user JWT via a
   * short-lived override client.
   */
  me(_jwt?: string): Promise<{ user: AppUser }> {
    return this.client.call<{ user: AppUser }>('GET', '/auth/me');
  }

  forgot(email: string, projectId?: string): Promise<{ message: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', '/auth/forgot', {
      body: { project_id: pid, email },
    });
  }

  reset(
    token: string,
    newPassword: string,
    projectId?: string,
  ): Promise<{ message: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', '/auth/reset', {
      body: { project_id: pid, token, new_password: newPassword },
    });
  }

  users(
    query: AuthUsersQuery = {},
    projectId?: string,
  ): Promise<{ users: AppUser[]; next_cursor?: string; count: number }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('GET', '/auth/users', {
      query: {
        project_id: pid,
        search: query.search,
        limit: query.limit,
        cursor: query.cursor,
        ids: query.ids?.join(','),
      },
    });
  }

  verifyEmail(code: string): Promise<{ verified: true }> {
    return this.client.call('POST', '/auth/verify-email', { body: { code } });
  }

  requestVerification(): Promise<{ sent: true; expires_in_seconds: number } | { already_verified: true }> {
    return this.client.call('POST', '/auth/request-email-verification');
  }

  deleteAccount(): Promise<{ deleted: true }> {
    return this.client.call('DELETE', '/auth/users/me');
  }

  updateMe(input: AuthUpdateMeInput): Promise<{ user: AppUser }> {
    return this.client.call('PATCH', '/auth/users/me', {
      body: { display_name: input.displayName, metadata: input.metadata },
    });
  }

  private requireProjectId(explicit?: string): string {
    const pid = this.client.resolveProjectId(explicit);
    if (!pid) {
      throw new Error('auth.* calls require a projectId (via argument or constructor).');
    }
    return pid;
  }
}
