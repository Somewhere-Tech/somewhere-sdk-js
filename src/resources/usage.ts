import type { Client } from '../client.js';

export interface UsageReport {
  period: string;
  totals: Record<string, number>;
  daily: Array<Record<string, unknown>>;
}

export interface UsageSummary {
  tier: 'free' | 'builder';
  limits: Record<string, number>;
  projects: number;
  totals_30d: Record<string, number>;
  totals_today: Record<string, number>;
}

export class UsageResource {
  constructor(private readonly client: Client) {}

  get(projectId?: string): Promise<UsageReport> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call<UsageReport>('GET', '/usage', {
      query: { project_id: pid, period: '30d' },
    });
  }

  summary(): Promise<UsageSummary> {
    return this.client.call<UsageSummary>('GET', '/usage/summary');
  }
}
