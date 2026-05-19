import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { Result } from '../types.js';
import { SomewhereQueryBuilder } from './postgrest.js';

/**
 * Stripe-style database namespace. Raw SQL plus the Supabase-style
 * query builder under one roof.
 *
 *     // Raw SQL — parameterized with $1, $2…
 *     const rows = await sw.db.query(
 *       'SELECT * FROM posts WHERE author_id = $1',
 *       [authorId],
 *     );
 *
 *     // DDL / migrations — developer key required
 *     await sw.db.migrate(`
 *       CREATE TABLE IF NOT EXISTS posts (
 *         id INTEGER PRIMARY KEY,
 *         title TEXT NOT NULL
 *       )
 *     `);
 *
 *     // Supabase-style query builder (alias of sw.from)
 *     const { data } = await sw.db.from('posts').select('*').eq('id', 1);
 */
export class DbClient {
  constructor(private readonly client: Client) {}

  /**
   * Run a raw SQL query. Postgres-style `$1` placeholders are normalized
   * to positional binds. Returns the rows array on success and throws a
   * `SomewhereError` on failure (use `try/catch`, not `{data, error}`).
   *
   * Accepts both `smt_` developer keys and app-user JWTs. App-user
   * sessions are subject to per-table user-scope enforcement.
   */
  async query<Row = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    options: { projectId?: string; timeoutMs?: number } = {},
  ): Promise<Row[]> {
    const projectId = this.client.requireProjectId(options.projectId, 'db.query');
    const body: Record<string, unknown> = { project_id: projectId, sql };
    if (params.length > 0) body.params = params;
    if (typeof options.timeoutMs === 'number') body.timeout_ms = options.timeoutMs;
    const result = await this.client.call<{ rows?: Row[]; results?: Row[]; data?: Row[] }>(
      'POST',
      '/db/query',
      { body },
    );
    return result?.rows ?? result?.results ?? result?.data ?? [];
  }

  /**
   * Run DDL (CREATE TABLE / ALTER / DROP / etc). Developer-only — the
   * server rejects app-user JWTs on this route.
   */
  async migrate(
    sql: string,
    options: { projectId?: string } = {},
  ): Promise<void> {
    const projectId = this.client.requireProjectId(options.projectId, 'db.migrate');
    await this.client.call('POST', '/db/migrate', {
      auth: 'developer',
      body: { project_id: projectId, sql },
    });
  }

  /**
   * Supabase-style query builder. Identical to `sw.from(table)` — exposed
   * here so devs who think in `sw.db.*` namespacing find it naturally.
   */
  from(table: string): SomewhereQueryBuilder {
    return new SomewhereQueryBuilder(this.client, table);
  }

  /**
   * List user tables in this project's database.
   */
  async tables(options: { projectId?: string } = {}): Promise<string[]> {
    const projectId = this.client.requireProjectId(options.projectId, 'db.tables');
    const result = await this.client.call<{ tables?: string[] }>(
      'GET',
      `/db/tables?project_id=${encodeURIComponent(projectId)}`,
    );
    return result?.tables ?? [];
  }

  /**
   * Inspect a single table's columns + indexes. Returns null if the
   * table doesn't exist.
   */
  async schema(
    table: string,
    options: { projectId?: string } = {},
  ): Promise<Record<string, unknown> | null> {
    const projectId = this.client.requireProjectId(options.projectId, 'db.schema');
    try {
      const result = await this.client.call<Record<string, unknown>>(
        'GET',
        `/db/schema?project_id=${encodeURIComponent(projectId)}&table=${encodeURIComponent(table)}`,
      );
      return result;
    } catch (err) {
      if (err instanceof SomewhereError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Run a batch of mutations as one atomic transaction. Statements
   * execute in order; if any fails the whole batch rolls back.
   */
  async batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
    options: { projectId?: string } = {},
  ): Promise<Result<Array<{ rows: Record<string, unknown>[]; rows_affected: number }>>> {
    const projectId = this.client.requireProjectId(options.projectId, 'db.batch');
    try {
      const result = await this.client.call<{
        results?: Array<{ rows: Record<string, unknown>[]; rows_affected: number }>;
      }>('POST', '/db/batch', {
        body: { project_id: projectId, statements },
      });
      return { data: result?.results ?? [], error: null, status: 200 };
    } catch (err) {
      if (err instanceof SomewhereError) {
        return { data: null, error: err, status: err.statusCode };
      }
      throw err;
    }
  }
}
