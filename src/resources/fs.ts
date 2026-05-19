import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { Result, StorageDownloadResult } from '../types.js';

/**
 * Raw filesystem namespace. Path-based read / write / list / delete
 * without the Supabase "buckets" abstraction. Use this when you're
 * thinking in absolute paths inside your project (`/assets/logo.png`,
 * `/data/users.json`).
 *
 *     await sw.fs.write('avatar.png', bytes, { contentType: 'image/png' });
 *     const file = await sw.fs.read('avatar.png');
 *     const entries = await sw.fs.list('/');
 *     await sw.fs.delete('avatar.png');
 *
 * For the Supabase-style bucket API see `sw.storage.from(bucket)`.
 */
export class FsClient {
  constructor(private readonly client: Client) {}

  /**
   * Write a file. Body can be a string, ArrayBuffer, Blob, ReadableStream,
   * or anything fetch accepts as a BodyInit. Path is stored verbatim
   * (no bucket prefix prepended).
   */
  async write(
    path: string,
    body: BodyInit,
    options: { contentType?: string; projectId?: string } = {},
  ): Promise<Result<{ path: string; size_bytes?: number; content_type?: string }>> {
    const projectId = this.client.requireProjectId(options.projectId, 'fs.write');
    const cleaned = trimLeadingSlash(path);
    try {
      const result = await this.client.putBytes<{
        path?: string;
        size_bytes?: number;
        content_type?: string;
      }>(
        `/fs/${enc(projectId)}/${encKey(cleaned)}`,
        body,
        options.contentType ?? inferContentType(body) ?? 'application/octet-stream',
      );
      return {
        data: {
          path: result.path ?? cleaned,
          size_bytes: result.size_bytes,
          content_type: result.content_type,
        },
        error: null,
        status: 200,
      };
    } catch (err) {
      return toResultError(err);
    }
  }

  /**
   * Read a file. Returns `{ body: ArrayBuffer, contentType, size }`.
   * Use `new TextDecoder().decode(result.data.body)` to get a string.
   */
  async read(
    path: string,
    options: { projectId?: string } = {},
  ): Promise<Result<StorageDownloadResult>> {
    const projectId = this.client.requireProjectId(options.projectId, 'fs.read');
    const cleaned = trimLeadingSlash(path);
    try {
      const result = await this.client.getBytes(
        `/fs/${enc(projectId)}/${encKey(cleaned)}`,
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /**
   * List entries under a directory path. Returns an array of `{ name,
   * size, content_type?, updated_at? }` objects.
   */
  async list(
    prefix = '',
    options: { projectId?: string } = {},
  ): Promise<
    Result<Array<{ name: string; size: number; content_type?: string; updated_at?: string }>>
  > {
    const projectId = this.client.requireProjectId(options.projectId, 'fs.list');
    const cleaned = trimLeadingSlash(prefix);
    try {
      const result = await this.client.getBytes(
        `/fs/${enc(projectId)}/${cleaned ? encKey(cleaned) : ''}`,
      );
      if (result.contentType.includes('application/json')) {
        const text = new TextDecoder().decode(result.body);
        const parsed = JSON.parse(text);
        const data = parsed?.ok ? parsed.data : parsed;
        if (data?.type === 'directory' && Array.isArray(data.entries)) {
          return {
            data: data.entries.map(
              (e: { name: string; size_bytes?: number; content_type?: string; updated_at?: string }) => ({
                name: e.name,
                size: e.size_bytes ?? 0,
                content_type: e.content_type,
                updated_at: e.updated_at,
              }),
            ),
            error: null,
            status: 200,
          };
        }
      }
      return { data: [], error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /**
   * Delete a single file. To delete many in one call use
   * `sw.storage.from(bucket).remove([...])`.
   */
  async delete(
    path: string,
    options: { projectId?: string } = {},
  ): Promise<Result<{ deleted: true }>> {
    const projectId = this.client.requireProjectId(options.projectId, 'fs.delete');
    const cleaned = trimLeadingSlash(path);
    try {
      await this.client.call('DELETE', `/fs/${enc(projectId)}/${encKey(cleaned)}`);
      return { data: { deleted: true }, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  /**
   * Public URL for a file. Only resolves if the file was marked public.
   * Does not perform a HEAD — the URL is constructed locally.
   */
  publicUrl(path: string, options: { projectId?: string } = {}): string {
    const projectId = this.client.requireProjectId(options.projectId, 'fs.publicUrl');
    const cleaned = trimLeadingSlash(path);
    return `${this.client.baseUrl}/fs/${enc(projectId)}/${encKey(cleaned)}`;
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function encKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function trimLeadingSlash(p: string): string {
  return p.startsWith('/') ? p.slice(1) : p;
}

function inferContentType(body: BodyInit): string | null {
  if (typeof Blob !== 'undefined' && body instanceof Blob && body.type) return body.type;
  if (typeof body === 'string') return 'text/plain; charset=utf-8';
  return null;
}

function toResultError<T>(err: unknown): Result<T> {
  if (err instanceof SomewhereError) {
    return { data: null, error: err, status: err.statusCode };
  }
  throw err;
}
