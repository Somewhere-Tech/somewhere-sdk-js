import type { Client } from '../client.js';

export interface EnvVar {
  key: string;
  created_at: string;
}

export class EnvResource {
  constructor(private readonly client: Client) {}

  set(key: string, value: string, projectId?: string): Promise<{ set: true }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/env', {
      body: { project_id: pid, key, value },
    });
  }

  list(projectId?: string): Promise<{ vars: EnvVar[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/env', { query: { project_id: pid } });
  }

  delete(key: string, projectId?: string): Promise<{ deleted: true }> {
    const pid = this.client.resolveProjectId(projectId);
    if (!pid) {
      throw new Error('env.delete requires a projectId (via argument or constructor).');
    }
    return this.client.call(
      'DELETE',
      `/env/${encodeURIComponent(pid)}/${encodeURIComponent(key)}`,
    );
  }
}
