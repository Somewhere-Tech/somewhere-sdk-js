import type { Client } from '../client.js';

export interface PreviewViewer {
  email: string;
  invited_at: string;
  last_viewed_at?: string | null;
}

export class PreviewResource {
  constructor(private readonly client: Client) {}

  invite(
    email: string,
    projectId?: string,
  ): Promise<{ email: string; invited_at: string; preview_url: string }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/preview/invite', {
      body: { project_id: pid, email },
    });
  }

  revoke(email: string, projectId?: string): Promise<{ revoked: true }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/preview/revoke', {
      body: { project_id: pid, email },
    });
  }

  viewers(projectId?: string): Promise<{ viewers: PreviewViewer[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/preview/viewers', {
      query: { project_id: pid },
    });
  }
}
