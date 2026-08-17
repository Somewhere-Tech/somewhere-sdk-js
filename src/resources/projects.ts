import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { Result } from '../types.js';

/**
 * Project control-plane operations. Access via `sw.projects`.
 *
 * These are developer operations: create the client with a developer key
 * (`new Somewhere({ key: 'smt_...' })`). Managing a project's cross-origin
 * allowlist is owner-or-platform-admin only and audited server-side.
 */
export interface ProjectAllowedOrigins {
  project_id?: string;
  /** The exact OTHER origins allowed to make credentialed cross-origin
   *  requests. A project's own origins (its `.somewhere.site` URL and verified
   *  custom domains) are always trusted and are not listed here. */
  allowed_origins: string[];
  cors_mode?: string;
  cors_grandfathered?: boolean;
  updated?: boolean;
}

export class ProjectsClient {
  constructor(private readonly client: Client) {}

  /** Read a project's exact cross-origin allowlist (CORS allowed_origins). */
  async getAllowedOrigins(projectId?: string): Promise<Result<ProjectAllowedOrigins>> {
    const id = this.client.requireProjectId(projectId, 'projects.getAllowedOrigins');
    try {
      const result = await this.client.call<ProjectAllowedOrigins>(
        'GET',
        `/projects/${encodeURIComponent(id)}/allowed-origins`,
        { auth: 'developer' },
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /**
   * Replace a project's cross-origin allowlist with these exact origins.
   * Owner-or-platform-admin only, and audited server-side. Each entry must be
   * an exact origin (scheme + host + optional port, no path or wildcards); the
   * platform validates and normalizes them — no client-side munging. Pass `[]`
   * to clear the allowlist.
   */
  async setAllowedOrigins(
    allowedOrigins: string[],
    projectId?: string,
  ): Promise<Result<ProjectAllowedOrigins>> {
    const id = this.client.requireProjectId(projectId, 'projects.setAllowedOrigins');
    try {
      const result = await this.client.call<ProjectAllowedOrigins>(
        'PUT',
        `/projects/${encodeURIComponent(id)}/allowed-origins`,
        { body: { allowed_origins: allowedOrigins }, auth: 'developer' },
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /** Remove all configured cross-origin origins (owner/admin only). */
  clearAllowedOrigins(projectId?: string): Promise<Result<ProjectAllowedOrigins>> {
    return this.setAllowedOrigins([], projectId);
  }
}

function toResultError<T>(err: unknown): Result<T> {
  if (err instanceof SomewhereError) {
    return { data: null, error: err, status: err.statusCode };
  }
  throw err;
}
