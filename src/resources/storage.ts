import type { Client } from '../client.js';
import type { StorageList } from '../types.js';

export interface StoragePutOptions {
  contentType?: string;
}

export interface StorageListOptions {
  prefix?: string;
  cursor?: string;
}

export class StorageResource {
  constructor(private readonly client: Client) {}

  put(
    key: string,
    body: BodyInit,
    opts: StoragePutOptions = {},
    projectId?: string,
  ): Promise<{ key: string; size: number; content_type: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.putBytes(
      `/storage/${encodeURIComponent(pid)}/${encodePath(key)}`,
      body,
      opts.contentType ?? 'application/octet-stream',
    );
  }

  async get(
    key: string,
    projectId?: string,
  ): Promise<{ body: ArrayBuffer; contentType: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.getBytes(
      `/storage/${encodeURIComponent(pid)}/${encodePath(key)}`,
    );
  }

  delete(
    key: string,
    projectId?: string,
  ): Promise<{ deleted: true; key: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call(
      'DELETE',
      `/storage/${encodeURIComponent(pid)}/${encodePath(key)}`,
    );
  }

  list(opts: StorageListOptions = {}, projectId?: string): Promise<StorageList> {
    const pid = this.requireProjectId(projectId);
    return this.client.call<StorageList>('GET', '/storage', {
      query: { project_id: pid, prefix: opts.prefix, cursor: opts.cursor },
    });
  }

  private requireProjectId(explicit?: string): string {
    const pid = this.client.resolveProjectId(explicit);
    if (!pid) {
      throw new Error('storage.* calls require a projectId (via argument or constructor).');
    }
    return pid;
  }
}

function encodePath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
