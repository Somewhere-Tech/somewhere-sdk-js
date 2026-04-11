import type { Client } from '../client.js';

export interface DomainRecord {
  domain: string;
  verified: boolean;
  cname_target?: string;
  created_at?: string;
}

export class DomainsResource {
  constructor(private readonly client: Client) {}

  add(
    domain: string,
    projectId?: string,
  ): Promise<{
    domain: string;
    cname_target: string;
    verified: false;
    instructions: string;
  }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/domains/add', {
      body: { project_id: pid, domain },
    });
  }

  verify(
    domain: string,
    _projectId?: string,
  ): Promise<{ domain: string; verified: boolean; cname_target: string }> {
    return this.client.call('GET', '/domains/verify', { query: { domain } });
  }

  list(projectId?: string): Promise<{ domains: DomainRecord[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('GET', '/domains', { query: { project_id: pid } });
  }

  delete(domain: string, _projectId?: string): Promise<{ deleted: true }> {
    return this.client.call('DELETE', `/domains/${encodeURIComponent(domain)}`);
  }
}
