import type { SomewhereError } from './errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SomewhereOptions {
  /** Developer `smt_` API key. Mutually exclusive with `token`. */
  key?: string;
  /** App-user JWT (issued by `auth.signInWithPassword`). Mutually exclusive with `key`. */
  token?: string;
  /** Default `project_id` used by every query/storage/auth/emails/chat call. */
  projectId?: string;
  /** Override the REST base URL. Defaults to `https://api.somewhere.tech/v1`. */
  baseUrl?: string;
  /** Inject a custom fetch implementation (tests, polyfills). */
  fetch?: FetchLike;
  /** Extra headers to attach to every request. */
  headers?: Record<string, string>;
}

/**
 * Every mutating call (db, storage, auth, emails) returns this shape —
 * matching Supabase / Resend exactly. `error` is null on success, and
 * `data` is null on error. Callers never throw-catch — they branch on
 * the error field.
 *
 * The one exception is `sw.chat.completions.create(...)` which throws,
 * matching the OpenAI SDK.
 */
export interface Result<T> {
  data: T | null;
  error: SomewhereError | null;
  count?: number | null;
  status?: number;
}

/* ─── Auth ─────────────────────────────────────────────────────── */

export interface User {
  id: string;
  email: string;
  display_name?: string | null;
  metadata?: Record<string, unknown> | null;
  email_verified?: boolean;
  created_at: string;
  [k: string]: unknown;
}

export interface Session {
  access_token: string;
  session_token?: string;
  user: User;
}

export interface AuthResponse {
  user: User | null;
  session: Session | null;
}

/* ─── Storage ──────────────────────────────────────────────────── */

export interface StorageFileObject {
  name: string;
  id?: string;
  bucket?: string;
  /** Bytes. */
  size: number;
  /** RFC-3339 timestamp. */
  updated_at?: string;
  /** Content type as stored on upload. */
  content_type?: string;
}

export interface StorageUploadResult {
  path: string;
  fullPath: string;
  id: string;
}

export interface StorageDownloadResult {
  body: ArrayBuffer;
  contentType: string;
}

/* ─── Chat completions (OpenAI shape) ─────────────────────────── */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  system?: string;
  /** Provider override — defaults to anthropic on the platform. */
  provider?: string;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/* ─── Email (Resend shape) ────────────────────────────────────── */

export interface SendEmailRequest {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

export interface SendEmailResponse {
  id: string;
}
