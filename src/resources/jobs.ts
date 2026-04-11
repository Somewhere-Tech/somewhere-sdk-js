import type { Client } from '../client.js';
import type { JobRecord } from '../types.js';

export interface JobCreateInput {
  handler: string;
  payload?: unknown;
  webhookUrl?: string;
  timeoutSeconds?: number;
  priority?: 'low' | 'normal';
}

export interface JobListQuery {
  status?: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  limit?: number;
}

export class JobsResource {
  constructor(private readonly client: Client) {}

  create(
    input: JobCreateInput,
    projectId?: string,
  ): Promise<{ job_id: string; status: 'queued' }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/jobs', {
      body: {
        project_id: pid,
        handler: input.handler,
        payload: input.payload,
        webhook_url: input.webhookUrl,
        timeout_seconds: input.timeoutSeconds,
        priority: input.priority,
      },
    });
  }

  status(jobId: string): Promise<JobRecord> {
    return this.client.call<JobRecord>('GET', `/jobs/${encodeURIComponent(jobId)}`);
  }

  list(query: JobListQuery = {}, projectId?: string): Promise<{ jobs: JobRecord[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/jobs', {
      query: { project_id: pid, status: query.status, limit: query.limit },
    });
  }

  cancel(jobId: string): Promise<{ job_id: string; status: 'cancelled' }> {
    return this.client.call('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`);
  }

  progress(
    jobId: string,
    input: { progress?: number; message?: string },
  ): Promise<{ job_id: string; progress: number; progress_message: string }> {
    return this.client.call('POST', `/jobs/${encodeURIComponent(jobId)}/progress`, {
      body: { progress: input.progress, message: input.message },
    });
  }
}
