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
  /** Long-lived (30d) opaque refresh token. Use `auth.refreshSession()` to mint a new pair. */
  refresh_token?: string;
  /** Server-side session id; pass to `auth.signOut()` to revoke. */
  session_token?: string;
  /** Seconds until `access_token` expires. */
  expires_in?: number;
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

export interface SignedUrlResult {
  url: string;
  token: string;
  path: string;
  expires_at: string;
  expires_in: number;
}

export interface IntegrityCheckResult {
  scanned: number;
  orphan_files: Array<{ id: string; path: string; r2_key: string }>;
  orphan_versions: Array<{ id: string; file_id: string; version: number; r2_key: string }>;
  auto_clean: boolean;
  cleaned: { files: number; versions: number };
  next_cursor: string | null;
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

/* ─── Payments (Stripe Connect, 5% platform fee) ─────────────────── */

export interface PaymentsOnboardRequest {
  /** Defaults to the client's default project. */
  projectId?: string;
  /** Where Stripe sends the user after the hosted onboarding completes. */
  return_url?: string;
  /** Where Stripe sends the user if the link expires before completion. */
  refresh_url?: string;
}

export interface PaymentsOnboardResponse {
  account_id: string;
  onboarding_url: string;
  /** RFC-3339 timestamp. The hosted link expires after a short window. */
  expires_at: string;
}

export interface PaymentsStatusOptions {
  projectId?: string;
  /** When true, re-fetches state from upstream — slower but reconciles after onboarding return. */
  refresh?: boolean;
}

export interface PaymentsStatusResponse {
  connected: boolean;
  account_id?: string;
  onboarded: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted?: boolean;
  country?: string | null;
  default_currency?: string | null;
}

export interface CheckoutLineItem {
  /** Existing Stripe price id on the connected account. Mutually exclusive with the inline form. */
  price?: string;
  /** Inline amount in the smallest currency unit (cents). Pair with currency + name. */
  amount?: number;
  currency?: string;
  name?: string;
  quantity?: number;
}

export interface PaymentsCheckoutRequest {
  projectId?: string;
  line_items: CheckoutLineItem[];
  mode?: 'payment' | 'subscription';
  success_url: string;
  cancel_url: string;
  customer_email?: string;
  metadata?: Record<string, string>;
}

export interface PaymentsCheckoutResponse {
  session_id: string;
  url: string;
  amount_total_cents: number;
  platform_fee_cents: number;
  fee_percent: number;
}

export interface PaymentsDashboardLinkResponse {
  url: string;
}

/* ─── Realtime (Supabase channels shape) ─────────────────────────── */

export interface RealtimeBroadcastResponse {
  delivered: number;
  channel: string;
}

export interface RealtimeMetaResponse {
  channel: string;
  subscribers: number;
  /** RFC-3339 timestamp or null if no message has been broadcast. */
  last_message_at: string | null;
}

/* ─── Video (Cloudflare Stream wrapper) ──────────────────────────── */

export interface VideoUploadUrlRequest {
  projectId?: string;
  title?: string;
  /** Caps the longest video the upload URL will accept. Clamped 30–21600s. */
  max_duration_seconds?: number;
  require_signed_urls?: boolean;
}

export interface VideoUploadUrlResponse {
  video_id: string;
  upload_url: string;
  max_duration_seconds: number;
}

export interface VideoObject {
  id: string;
  project_id: string;
  title: string | null;
  ready: boolean;
  status: string;
  size_bytes: number;
  duration_seconds: number;
  thumbnail: string;
  preview: string;
  hls_url: string;
  dash_url: string;
  /** RFC-3339 timestamp. */
  created_at: string;
  /** RFC-3339 timestamp. */
  modified_at: string;
}

export interface VideoListResponse {
  videos: VideoObject[];
  count: number;
}

/* ─── Inbox (inbound email) ──────────────────────────────────────── */

export interface InboxAddressCreateRequest {
  projectId?: string;
  /** Local-part only. The platform adds the inbox.{platform-domain} suffix. */
  local: string;
  label?: string;
}

export interface InboxAddress {
  id: string;
  project_id: string;
  address: string;
  label: string | null;
  /** RFC-3339 timestamp. */
  created_at: string;
}

export interface InboxAddressListResponse {
  addresses: InboxAddress[];
}

export interface InboxMessageSummary {
  id: string;
  address_id: string;
  project_id: string;
  mail_from: string;
  mail_to: string;
  subject: string | null;
  text_preview: string | null;
  size_bytes: number;
  /** RFC-3339 timestamp. */
  received_at: string;
}

export interface InboxMessageListResponse {
  messages: InboxMessageSummary[];
  count: number;
}

export interface InboxMessageDetail extends InboxMessageSummary {
  r2_key: string;
  /** Sub-path on the API base URL that returns the raw .eml bytes. */
  raw_url: string;
}

export interface InboxListOptions {
  projectId?: string;
  addressId?: string;
  limit?: number;
}

/* ─── Calls (WebRTC SFU passthrough) ─────────────────────────────── */

export interface CallsSessionCreateRequest {
  projectId?: string;
  thirdparty?: boolean;
}

export interface CallsSessionCreateResponse {
  session_id: string;
  project_id: string;
}
