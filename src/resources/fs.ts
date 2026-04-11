import type { Client } from '../client.js';
import type {
  FsDirectoryListing,
  FsStat,
  FsVersions,
  FsWriteResult,
} from '../types.js';

export interface FsWriteOptions {
  contentType?: string;
}

export class FsResource {
  constructor(private readonly client: Client) {}

  write(
    path: string,
    body: BodyInit,
    opts: FsWriteOptions = {},
    projectId?: string,
  ): Promise<FsWriteResult> {
    const pid = this.requireProjectId(projectId);
    return this.client.putBytes(
      `/fs/${encodeURIComponent(pid)}/${encodePath(path)}`,
      body,
      opts.contentType ?? 'application/octet-stream',
    );
  }

  /**
   * Read a file or directory. Returns `{body, contentType}` for files, or
   * `{type: 'directory', entries}` when the path is a directory.
   */
  async read(
    path: string,
    projectId?: string,
  ): Promise<{ body: ArrayBuffer; contentType: string } | FsDirectoryListing> {
    const pid = this.requireProjectId(projectId);
    const result = await this.client.getBytes(
      `/fs/${encodeURIComponent(pid)}/${encodePath(path)}`,
    );
    // Directory responses come back as JSON; files as raw bytes.
    if (result.contentType.includes('application/json')) {
      const text = new TextDecoder().decode(result.body);
      const parsed = JSON.parse(text) as { ok?: boolean; data?: FsDirectoryListing };
      if (parsed.ok && parsed.data && parsed.data.type === 'directory') {
        return parsed.data;
      }
    }
    return result;
  }

  delete(
    path: string,
    projectId?: string,
  ): Promise<{ deleted: number; type: 'file' | 'directory'; path: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call(
      'DELETE',
      `/fs/${encodeURIComponent(pid)}/${encodePath(path)}`,
    );
  }

  move(
    from: string,
    to: string,
    projectId?: string,
  ): Promise<{ from: string; to: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/move`, {
      body: { from, to },
    });
  }

  copy(
    from: string,
    to: string,
    projectId?: string,
  ): Promise<{ from: string; to: string }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/copy`, {
      body: { from, to },
    });
  }

  stat(path: string, projectId?: string): Promise<FsStat> {
    const pid = this.requireProjectId(projectId);
    return this.client.call<FsStat>(
      'GET',
      `/fs/${encodeURIComponent(pid)}/stat/${encodePath(path)}`,
    );
  }

  versions(path: string, projectId?: string): Promise<FsVersions> {
    const pid = this.requireProjectId(projectId);
    return this.client.call<FsVersions>(
      'GET',
      `/fs/${encodeURIComponent(pid)}/versions/${encodePath(path)}`,
    );
  }

  restore(
    path: string,
    version: number,
    projectId?: string,
  ): Promise<{ path: string; restored_version: number; current_version: number }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/restore`, {
      body: { path, version },
    });
  }

  private requireProjectId(explicit?: string): string {
    const pid = this.client.resolveProjectId(explicit);
    if (!pid) {
      throw new Error('fs.* calls require a projectId (via argument or constructor).');
    }
    return pid;
  }
}

function encodePath(path: string): string {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  return trimmed.split('/').map(encodeURIComponent).join('/');
}
