export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SomewhereOptions {
  /** Developer `smt_` API key. Mutually exclusive with `token`. */
  key?: string;
  /** App-user JWT. Mutually exclusive with `key`. */
  token?: string;
  /** Default `project_id` used when a per-call `projectId` isn't passed. */
  projectId?: string;
  /** Override the REST base URL. Defaults to `https://api.somewhere.tech/v1`. */
  baseUrl?: string;
  /** Inject a custom fetch implementation (tests, polyfills). */
  fetch?: FetchLike;
  /** Extra headers to attach to every request. */
  headers?: Record<string, string>;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
  retry?: boolean;
  retry_after_ms?: number | null;
  [k: string]: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/* ─── Domain types (light — matches AGENT.md response shapes) ─────── */

export interface Project {
  id: string;
  name: string;
  slug?: string;
  subdomain: string;
  description?: string | null;
  status?: 'draft' | 'deployed' | 'archived' | 'frozen' | 'active';
  url?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface ProjectList {
  projects: Project[];
  deployed_count?: number;
  deploy_limit?: number;
  tier?: string;
}

export interface DeployResult {
  files: number;
  url: string;
  environment: 'dev' | 'prod';
  promote_url?: string;
  has_functions?: boolean;
  functions?: Record<string, unknown>;
}

export interface DbQueryResult<Row = Record<string, unknown>> {
  columns: string[];
  rows: Row[];
  meta?: {
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
  };
}

export interface DbTables {
  tables: string[];
}

export interface DbSchemaColumn {
  name: string;
  type: string;
  not_null: boolean;
  default: unknown;
  primary_key: boolean;
}

export interface DbSchema {
  table: string;
  columns: DbSchemaColumn[];
  row_count: number;
}

export interface StorageObject {
  key: string;
  size: number;
  uploaded: string;
  content_type: string;
}

export interface StorageList {
  objects: StorageObject[];
  truncated: boolean;
  cursor: string | null;
  total: number;
}

export interface FsWriteResult {
  path: string;
  size_bytes: number;
  content_type: string;
  version: number;
}

export interface FsStat {
  path: string;
  type: 'file' | 'directory';
  size_bytes: number;
  content_type: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FsDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size_bytes?: number;
  content_type?: string;
  updated_at?: string;
}

export interface FsDirectoryListing {
  type: 'directory';
  entries: FsDirectoryEntry[];
}

export interface FsVersion {
  version: number;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

export interface FsVersions {
  current_version: number;
  versions: FsVersion[];
}

export interface AppUser {
  id: string;
  email: string;
  display_name?: string | null;
  metadata?: Record<string, unknown> | null;
  email_verified?: boolean;
  created_at: string;
  [k: string]: unknown;
}

export interface AuthLoginResult {
  user: AppUser;
  token: string;
  session_token?: string;
}

export interface AiCompleteMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiCompleteResult {
  content: string;
  model: string;
  provider: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  cost: {
    api_cost: number;
    platform_fee: number;
    total: number;
    currency: string;
  };
}

export interface JobRecord {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress?: number;
  progress_message?: string;
  execution_tier?: 'worker' | 'workflow' | 'container';
  attempts?: Array<{
    tier: 'worker' | 'workflow' | 'container';
    started_at: string;
    duration_ms: number;
    outcome: 'success' | 'timeout' | 'error';
  }>;
  result?: unknown;
  error?: string;
}

export interface CronRecord {
  cron_id: string;
  name?: string | null;
  schedule: string;
  handler: string;
  enabled: boolean;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_run_job_id?: string | null;
  next_run_at?: string | null;
}

export interface BillingStatus {
  tier: 'free' | 'builder';
  included_apps: number;
  additional_apps: number;
  total_app_slots: number;
  apps_used: number;
  trial_active?: boolean;
  subscription_status?: string;
  current_period_end?: string | null;
  monthly_cost?: number;
  usage_this_month?: Record<string, unknown>;
}
