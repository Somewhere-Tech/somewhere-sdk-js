import type { Client } from '../client.js';
import type { Project, ProjectList } from '../types.js';

export interface ProjectCreateInput {
  name: string;
  description?: string;
  subdomain?: string;
}

export interface ProjectRenameInput {
  name?: string;
  subdomain?: string;
  description?: string;
}

export class ProjectsResource {
  constructor(private readonly client: Client) {}

  create(input: ProjectCreateInput): Promise<Project> {
    return this.client.call<Project>('POST', '/projects', { body: input });
  }

  list(): Promise<ProjectList> {
    return this.client.call<ProjectList>('GET', '/projects');
  }

  get(id: string): Promise<Project> {
    return this.client.call<Project>('GET', `/projects/${encodeURIComponent(id)}`);
  }

  delete(id: string): Promise<{ deleted: true }> {
    return this.client.call('DELETE', `/projects/${encodeURIComponent(id)}`);
  }

  undeploy(id: string): Promise<{ status: 'draft'; slug: string }> {
    return this.client.call('POST', `/projects/${encodeURIComponent(id)}/undeploy`);
  }

  archive(id: string): Promise<{ status: 'archived' }> {
    return this.client.call('POST', `/projects/${encodeURIComponent(id)}/archive`);
  }

  unarchive(id: string): Promise<{ status: 'draft' }> {
    return this.client.call('POST', `/projects/${encodeURIComponent(id)}/unarchive`);
  }

  rename(id: string, input: ProjectRenameInput): Promise<Project> {
    return this.client.call<Project>('PATCH', `/projects/${encodeURIComponent(id)}`, {
      body: input,
    });
  }

  deploys(id: string): Promise<{ deploys: Array<{ date: string; deploys: number }> }> {
    return this.client.call('GET', `/projects/${encodeURIComponent(id)}/deploys`);
  }
}
