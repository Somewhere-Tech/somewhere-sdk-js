import type { Client } from '../client.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogWriteInput {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogReadQuery {
  level?: LogLevel;
  source?: string;
  search?: string;
  after?: string;
  before?: string;
  limit?: number;
}

export interface LogEntry {
  id: string;
  project_id: string;
  level: LogLevel;
  message: string;
  source: string;
  data?: Record<string, unknown>;
  created_at: string;
}

export class LogsResource {
  constructor(private readonly client: Client) {}

  write(
    input: LogWriteInput,
    projectId?: string,
  ): Promise<{ logged: true; quota_used: number; quota_limit: number }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/logs', {
      body: {
        project_id: pid,
        level: input.level,
        message: input.message,
        data: input.data,
      },
    });
  }

  read(
    query: LogReadQuery = {},
    projectId?: string,
  ): Promise<{ logs: LogEntry[]; has_more: boolean; cursor: string | null }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/logs', {
      query: { project_id: pid, ...query },
    });
  }
}
