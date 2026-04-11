import type { Client } from '../client.js';
import type { CronRecord } from '../types.js';

export interface CronCreateInput {
  schedule: string;
  handler: string;
  payload?: unknown;
  name?: string;
  enabled?: boolean;
}

export interface CronUpdateInput {
  schedule?: string;
  handler?: string;
  payload?: unknown;
  enabled?: boolean;
  name?: string;
}

export class CronResource {
  constructor(private readonly client: Client) {}

  create(
    input: CronCreateInput,
    projectId?: string,
  ): Promise<{ cron_id: string; schedule: string; next_run: string }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/cron', {
      body: {
        project_id: pid,
        schedule: input.schedule,
        handler: input.handler,
        payload: input.payload,
        name: input.name,
        enabled: input.enabled,
      },
    });
  }

  list(projectId?: string): Promise<{ crons: CronRecord[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/cron', { query: { project_id: pid } });
  }

  update(id: string, input: CronUpdateInput): Promise<CronRecord> {
    return this.client.call<CronRecord>('PATCH', `/cron/${encodeURIComponent(id)}`, {
      body: {
        schedule: input.schedule,
        handler: input.handler,
        payload: input.payload,
        enabled: input.enabled,
        name: input.name,
      },
    });
  }

  delete(id: string): Promise<{ deleted: true }> {
    return this.client.call('DELETE', `/cron/${encodeURIComponent(id)}`);
  }
}
