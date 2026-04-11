import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type {
  Result,
  StorageDownloadResult,
  StorageFileObject,
  StorageUploadResult,
} from '../types.js';

/**
 * Supabase Storage-style bucket API.
 *
 *     const { data, error } = await sw.storage
 *       .from('avatars')
 *       .upload('user-42.png', file, { contentType: 'image/png' })
 *
 *     const { data, error } = await sw.storage
 *       .from('avatars')
 *       .download('user-42.png')
 *
 *     const { data } = await sw.storage.from('avatars').list('folder/')
 *     const { data } = await sw.storage.from('avatars').remove(['user-42.png'])
 *     const { data } = await sw.storage.from('avatars').getPublicUrl('user-42.png')
 *
 * "Buckets" are mapped onto prefixes in the per-project R2 bucket —
 * `storage.from('avatars').upload('a.png', ...)` ends up at key
 * `avatars/a.png` under the project. The caller never sees raw R2 paths
 * or project IDs.
 */
export class StorageClient {
  constructor(private readonly client: Client) {}

  from(bucket: string): StorageFileApi {
    return new StorageFileApi(this.client, bucket);
  }
}

export interface UploadOptions {
  contentType?: string;
  /** When true, the file will overwrite the existing object. Defaults to false. */
  upsert?: boolean;
}

export class StorageFileApi {
  constructor(
    private readonly client: Client,
    private readonly bucket: string,
  ) {}

  /**
   * Upload a file to the bucket. `fileBody` can be an `ArrayBuffer`,
   * `Uint8Array`, `Blob`, `File`, or plain string.
   */
  async upload(
    path: string,
    fileBody: BodyInit,
    options: UploadOptions = {},
  ): Promise<Result<StorageUploadResult>> {
    const projectId = this.requireProjectId('upload');
    const fullPath = this.fullKey(path);
    try {
      const result = await this.client.putBytes<{
        key: string;
        size: number;
        content_type: string;
      }>(
        `/storage/${encodePathSegment(projectId)}/${encodeKey(fullPath)}`,
        fileBody,
        options.contentType ?? inferContentType(fileBody) ?? 'application/octet-stream',
      );
      return {
        data: {
          path,
          fullPath: result.key ?? fullPath,
          id: result.key ?? fullPath,
        },
        error: null,
        status: 200,
      };
    } catch (err) {
      return toResultError(err);
    }
  }

  /** Download a file. Returns raw bytes + content type. */
  async download(path: string): Promise<Result<StorageDownloadResult>> {
    const projectId = this.requireProjectId('download');
    const fullPath = this.fullKey(path);
    try {
      const result = await this.client.getBytes(
        `/storage/${encodePathSegment(projectId)}/${encodeKey(fullPath)}`,
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /** List files in this bucket, optionally under a sub-prefix. */
  async list(
    prefix = '',
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Result<StorageFileObject[]>> {
    const projectId = this.requireProjectId('list');
    const fullPrefix = prefix ? this.fullKey(prefix) : `${this.bucket}/`;
    try {
      const result = await this.client.call<{
        objects?: Array<{
          key: string;
          size: number;
          uploaded?: string;
          updated?: string;
          content_type?: string;
        }>;
      }>('GET', '/storage', {
        query: {
          project_id: projectId,
          prefix: fullPrefix,
          cursor: options.cursor,
          limit: options.limit,
        },
      });
      const objects: StorageFileObject[] = (result.objects ?? []).map((o) => ({
        name: o.key.startsWith(`${this.bucket}/`) ? o.key.slice(this.bucket.length + 1) : o.key,
        size: o.size,
        updated_at: o.updated ?? o.uploaded,
        content_type: o.content_type,
      }));
      return { data: objects, error: null, status: 200 };
    } catch (err) {
      return toResultError<StorageFileObject[]>(err);
    }
  }

  /** Delete one or more files from this bucket. */
  async remove(paths: string[]): Promise<Result<StorageFileObject[]>> {
    const projectId = this.requireProjectId('remove');
    const removed: StorageFileObject[] = [];
    for (const path of paths) {
      const fullPath = this.fullKey(path);
      try {
        await this.client.call(
          'DELETE',
          `/storage/${encodePathSegment(projectId)}/${encodeKey(fullPath)}`,
        );
        removed.push({ name: path, size: 0 });
      } catch (err) {
        return toResultError<StorageFileObject[]>(err);
      }
    }
    return { data: removed, error: null, status: 200 };
  }

  /**
   * Construct a public URL for an object. Does not make an HTTP request —
   * it just builds a deterministic URL on `{subdomain}.somewhere.tech`.
   * Matching Supabase's `getPublicUrl`, this returns synchronously via a
   * `{data}` wrapper for API consistency.
   */
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    const projectId = this.requireProjectId('getPublicUrl');
    const fullPath = this.fullKey(path);
    const baseUrl = this.client.baseUrl;
    const publicUrl = `${baseUrl}/storage/${encodePathSegment(projectId)}/${encodeKey(fullPath)}`;
    return { data: { publicUrl } };
  }

  private fullKey(path: string): string {
    const trimmed = path.startsWith('/') ? path.slice(1) : path;
    return `${this.bucket}/${trimmed}`;
  }

  private requireProjectId(method: string): string {
    return this.client.requireProjectId(undefined, `storage.from('${this.bucket}').${method}`);
  }
}

function encodePathSegment(s: string): string {
  return encodeURIComponent(s);
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function inferContentType(body: BodyInit): string | null {
  if (typeof Blob !== 'undefined' && body instanceof Blob && body.type) {
    return body.type;
  }
  if (typeof body === 'string') {
    return 'text/plain; charset=utf-8';
  }
  return null;
}

function toResultError<T>(err: unknown): Result<T> {
  if (err instanceof SomewhereError) {
    return { data: null, error: err, status: err.statusCode };
  }
  throw err;
}
