import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { FunctionInvokeOptions, Result } from '../types.js';

/**
 * Supabase Edge Functions-style client.
 *
 *     const { data, error } = await sw.functions.invoke('checkout', {
 *       body: { plan: 'pro' },
 *     })
 *
 * `invoke(name)` calls `POST {projectUrl}/api/{name}` — the project's own
 * deployed function (an `api/{name}` file). `data` is the function's parsed
 * JSON response (or text); `error` is set on any non-2xx status or network
 * failure, matching Supabase's `{ data, error }` envelope.
 *
 * The function host is the URL you passed to `createClient(url, key)`. When
 * the client was built with `new Somewhere({ key, projectId })` instead, the
 * host is derived as `https://{projectId}.somewhere.tech` when `projectId`
 * is a slug. A UUID `projectId` (or a custom domain you didn't pass) can't
 * be turned into a host — `invoke` then returns a loud `NO_FUNCTION_HOST`
 * error telling you to use `createClient(url, …)` or pass `functionsUrl`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

export class FunctionsClient {
  constructor(private readonly client: Client) {}

  async invoke<T = unknown>(
    name: string,
    options: FunctionInvokeOptions = {},
  ): Promise<Result<T>> {
    const base = this.resolveBase();
    if (!base) {
      return errored(
        'NO_FUNCTION_HOST',
        "functions.invoke needs the project's URL. Build the client with " +
          "createClient('https://<project>.somewhere.tech', key), or pass " +
          '{ functionsUrl } / a slug projectId.',
        400,
      );
    }

    const fn = name.replace(/^\/+/, '').replace(/^api\//, '');
    if (!fn) {
      return errored('VALIDATION_ERROR', 'functions.invoke requires a function name.', 400);
    }
    const url = `${base}/api/${fn}`;
    const method = options.method ?? 'POST';

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.client.sessionOrInitialBearer,
      ...(options.headers ?? {}),
    };

    let body: BodyInit | undefined;
    if (options.body !== undefined && method !== 'GET') {
      if (isBinary(options.body)) {
        body = options.body as BodyInit;
      } else if (typeof options.body === 'string') {
        body = options.body;
        headers['Content-Type'] ??= 'text/plain;charset=UTF-8';
      } else {
        body = JSON.stringify(options.body);
        headers['Content-Type'] ??= 'application/json';
      }
    }

    let res: Response;
    try {
      res = await this.client.rawFetch(url, { method, headers, body });
    } catch (err) {
      return errored(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : `Network error reaching ${url}.`,
        0,
        true,
      );
    }

    const parsed = await readBody(res);
    if (!res.ok) {
      const b = parsed as { error?: string; message?: string } | null;
      return {
        data: null,
        error: new SomewhereError({
          code: b?.error ?? `FUNCTION_HTTP_${res.status}`,
          message: b?.message ?? `Function '${fn}' returned ${res.status}.`,
          statusCode: res.status,
          retry: res.status >= 500,
          retryAfterMs: null,
          body: parsed,
        }),
        status: res.status,
      };
    }
    return { data: parsed as T, error: null, status: res.status };
  }

  /** Resolve the function host, or null if it can't be determined. */
  private resolveBase(): string | null {
    if (this.client.functionsUrl) return this.client.functionsUrl;
    const pid = this.client.resolveProjectId();
    if (pid && SLUG_RE.test(pid) && !UUID_RE.test(pid)) {
      return `https://${pid}.somewhere.tech`;
    }
    return null;
  }
}

function errored<T>(
  code: string,
  message: string,
  statusCode: number,
  retry = false,
): Result<T> {
  return {
    data: null,
    error: new SomewhereError({ code, message, statusCode, retry, retryAfterMs: null }),
    status: statusCode,
  };
}

function isBinary(body: unknown): boolean {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(body as ArrayBufferView)) return true;
  return false;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
