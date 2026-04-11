export interface SomewhereErrorInit {
  code: string;
  message: string;
  statusCode: number;
  retry: boolean;
  retryAfterMs: number | null;
  body?: unknown;
}

export class SomewhereError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retry: boolean;
  readonly retryAfterMs: number | null;
  readonly body: unknown;

  constructor(init: SomewhereErrorInit) {
    super(init.message);
    this.name = 'SomewhereError';
    this.code = init.code;
    this.statusCode = init.statusCode;
    this.retry = init.retry;
    this.retryAfterMs = init.retryAfterMs;
    this.body = init.body;
  }
}
