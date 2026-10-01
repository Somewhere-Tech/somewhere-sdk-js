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

export type SeoStatus = 'automatic' | 'app-supplied' | 'needs-attention' | 'unknown';
export interface SeoMetadataItem {
  name: string;
  status: SeoStatus;
  provenance: 'platform-fallback' | 'release-html' | 'release-file' | 'unobserved';
  values: string[];
  value_count: number;
  values_truncated: boolean;
  note: string;
  suggestion: string | null;
}
export interface ProjectSeoMetadata {
  project_id: string;
  release_id: string;
  version: number;
  source_manifest_hash: string;
  compiled_artifact_digest: string;
  checked_at: string;
  label: 'Deployed SEO metadata';
  items: SeoMetadataItem[];
  coverage: {
    paths: ['/'];
    mode: 'static-homepage-only';
    client_routes: 'unknown';
    public_response: 'unobserved';
    note: string;
  };
}

export interface AnalyticsConsentPolicy {
  mode: 'off' | 'required';
  policy_version: string;
}
export interface ProjectUpdateInput {
  analytics_consent: AnalyticsConsentPolicy;
}
export interface ProjectUpdateResult {
  updated: true;
  analytics_consent: AnalyticsConsentPolicy | null;
}

export class ProjectsClient {
  constructor(private readonly client: Client) {}

  /** Update the optional analytics consent policy; the platform validates policy and editor access. */
  async update(settings: ProjectUpdateInput, projectId?: string): Promise<Result<ProjectUpdateResult>> {
    const id = this.client.requireProjectId(projectId, 'projects.update');
    try {
      const result = await this.client.call<ProjectUpdateResult>(
        'PATCH',
        `/projects/${encodeURIComponent(id)}`,
        { body: settings, auth: 'developer' },
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /** Inspect deployed homepage files and configured SEO defaults; live rendering and indexing remain unverified. */
  async seoCheck(projectId?: string): Promise<Result<ProjectSeoMetadata>> {
    const id = this.client.requireProjectId(projectId, 'projects.seoCheck');
    try {
      const result = await this.client.call<ProjectSeoMetadata>(
        'GET',
        `/projects/${encodeURIComponent(id)}/seo`,
        { auth: 'developer' },
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

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
