import { SomewhereError } from './errors.js';
import type { ApiError, ApiResponse, FetchLike, SomewhereOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://api.somewhere.tech/v1';

function isBinaryBody(body: unknown): boolean {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(body as ArrayBufferView)) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return true;
  return false;
}

export class Client {
  readonly baseUrl: string;
  readonly defaultProjectId?: string;
  private readonly authHeader: string;
  private readonly fetchImpl: FetchLike;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: SomewhereOptions) {
    if (!opts.key && !opts.token) {
      throw new Error('Somewhere: pass either `key` (smt_...) or `token` (app-user JWT).');
    }
    if (opts.key && opts.token) {
      throw new Error('Somewhere: pass `key` OR `token`, not both.');
    }
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.defaultProjectId = opts.projectId;
    this.authHeader = `Bearer ${opts.key ?? opts.token}`;
    this.extraHeaders = opts.headers ?? {};
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error('Somewhere: no fetch implementation found. Pass `fetch` explicitly.');
    }
    this.fetchImpl = f;
  }

  resolveProjectId(explicit?: string): string | undefined {
    return explicit ?? this.defaultProjectId;
  }

  /** JSON request → JSON response. Unwraps `{ok, data}` → `data`, throws on error. */
  async call<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      ...this.extraHeaders,
    };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      if (isBinaryBody(opts.body)) {
        // Let the runtime set Content-Type (multipart boundary, etc.).
        body = opts.body as BodyInit;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
    }
    const res = await this.fetchImpl(url, { method, headers, body });
    const parsed = await this.parseJson(res);
    return this.unwrap<T>(parsed, res.status);
  }

  /** Raw binary download — used by storage.get / fs.read for file bodies. */
  async getBytes(
    path: string,
    query?: Record<string, unknown>,
  ): Promise<{ body: ArrayBuffer; contentType: string }> {
    const url = this.buildUrl(path, query);
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: this.authHeader, ...this.extraHeaders },
    });
    if (!res.ok) {
      const parsed = await this.parseJson(res).catch(() => null);
      throw this.toError(parsed as ApiError | null, res.status);
    }
    return {
      body: await res.arrayBuffer(),
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /** Raw binary upload — used by storage.put / fs.write. */
  async putBytes<T = unknown>(
    path: string,
    body: BodyInit,
    contentType: string,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': contentType,
        Accept: 'application/json',
        ...this.extraHeaders,
      },
      body,
    });
    const parsed = await this.parseJson(res);
    return this.unwrap<T>(parsed, res.status);
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const base = `${this.baseUrl}${suffix}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private async parseJson(res: Response): Promise<ApiResponse<unknown> | null> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as ApiResponse<unknown>;
    } catch {
      throw new SomewhereError({
        code: 'INVALID_RESPONSE',
        message: `Non-JSON response (status ${res.status}): ${text.slice(0, 200)}`,
        statusCode: res.status,
        retry: res.status >= 500,
        retryAfterMs: null,
      });
    }
  }

  private unwrap<T>(parsed: ApiResponse<unknown> | null, statusCode: number): T {
    if (parsed && parsed.ok === true) {
      return parsed.data as T;
    }
    throw this.toError(parsed as ApiError | null, statusCode);
  }

  private toError(parsed: ApiError | null, statusCode: number): SomewhereError {
    if (parsed && parsed.ok === false) {
      const retryAfterMs =
        typeof parsed.retry_after_ms === 'number' ? parsed.retry_after_ms : null;
      return new SomewhereError({
        code: parsed.error ?? 'UNKNOWN_ERROR',
        message: parsed.message ?? 'Unknown error',
        statusCode,
        retry: parsed.retry === true,
        retryAfterMs,
        body: parsed,
      });
    }
    return new SomewhereError({
      code: 'INVALID_RESPONSE',
      message: `Unexpected response shape (status ${statusCode})`,
      statusCode,
      retry: statusCode >= 500,
      retryAfterMs: null,
      body: parsed,
    });
  }
}
