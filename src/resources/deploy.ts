import type { Client } from '../client.js';
import type { DeployResult } from '../types.js';

export interface DeployInput {
  /** Defaults to the client's `projectId` if not set here. */
  projectId?: string;
  /** Map of file path → file contents (string, base64, or an object with `content`). */
  files: Record<string, unknown>;
  /** Optional server-side functions. Pass `{}` to remove a previous functions deployment. */
  functions?: Record<string, unknown>;
}

export interface DeployStatus {
  dev_updated_at: string | null;
  prod_updated_at: string | null;
  in_sync: boolean;
  dev_ahead: boolean;
  files_changed: number;
  dev_file_count: number;
  prod_file_count: number;
}

/**
 * Deploy is unusual: it's callable as a function AND has sub-methods
 * (`deploy.status(...)`, etc.). This callable-object pattern is what the
 * `DeployNamespace` type captures. Built via `createDeployNamespace`.
 */
export interface DeployNamespace {
  (input: DeployInput): Promise<DeployResult>;
  status(projectId?: string): Promise<DeployStatus>;
}

export function createDeployNamespace(client: Client): DeployNamespace {
  const fn = ((input: DeployInput) => {
    const projectId = client.resolveProjectId(input.projectId);
    return client.call<DeployResult>('POST', '/deploy', {
      body: {
        project_id: projectId,
        files: input.files,
        functions: input.functions,
      },
    });
  }) as DeployNamespace;

  fn.status = (projectId?: string) => {
    const pid = client.resolveProjectId(projectId);
    return client.call<DeployStatus>('GET', '/deploy/status', {
      query: { project_id: pid },
    });
  };

  return fn;
}

export interface PromoteNamespace {
  (projectId?: string): Promise<{
    promoted_at: string;
    files_promoted: number;
    files_archived: number;
    has_functions: boolean;
    rollback_available: boolean;
  }>;
  rollback(projectId?: string): Promise<{
    rolled_back_at: string;
    files_restored: number;
  }>;
}

export function createPromoteNamespace(client: Client): PromoteNamespace {
  const fn = ((projectId?: string) => {
    const pid = client.resolveProjectId(projectId);
    return client.call('POST', '/promote', { body: { project_id: pid } });
  }) as PromoteNamespace;

  fn.rollback = (projectId?: string) => {
    const pid = client.resolveProjectId(projectId);
    return client.call('POST', '/promote/rollback', { body: { project_id: pid } });
  };

  return fn;
}
