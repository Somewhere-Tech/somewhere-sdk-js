import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { Result } from '../types.js';

/**
 * Supabase-style query builder.
 *
 * Usage matches `@supabase/supabase-js` for the common subset:
 *
 *     const { data, error } = await sw.from('users').select('*').eq('id', 1)
 *     const { data, error } = await sw.from('users').insert({ name: 'A' })
 *     const { data, error } = await sw
 *       .from('users')
 *       .update({ status: 'active' })
 *       .eq('id', 1)
 *     const { data, error } = await sw.from('users').delete().eq('id', 1)
 *
 * The SDK translates the fluent chain to SQLite parameterized SQL and
 * routes it through `POST /v1/db/query`. All values travel as `?`
 * parameters — identifiers (table + column names) are validated against
 * a strict regex and quoted so there's no injection surface.
 */

interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'ILIKE' | 'IS' | 'IN';

type ResolveType = 'many' | 'single' | 'maybeSingle';

type Action = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdent(ident: string): string {
  // Allow qualified `table.column` by splitting on the dot.
  const parts = ident.split('.');
  for (const p of parts) {
    if (!IDENT_RE.test(p)) {
      throw new Error(
        `Somewhere: invalid identifier ${JSON.stringify(ident)}. ` +
          `Only ASCII letters, digits, and underscores are allowed.`,
      );
    }
  }
  return parts.map((p) => `"${p}"`).join('.');
}

function splitColumns(columns: string): string[] {
  return columns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

function invalidResult<T>(err: SomewhereError): Result<T> {
  return { data: null, error: err, count: null, status: err.statusCode };
}

/** What `.from(...)` returns — pre-action chain. */
export class SomewhereQueryBuilder {
  constructor(
    private readonly client: Client,
    private readonly table: string,
  ) {}

  select(columns = '*'): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'select', {
      columns,
    });
  }

  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'insert', {
      insertValues: Array.isArray(values) ? values : [values],
    });
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string } = {},
  ): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'upsert', {
      insertValues: Array.isArray(values) ? values : [values],
      conflictKey: options.onConflict ?? 'id',
    });
  }

  update(values: Record<string, unknown>): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'update', {
      updateValues: values,
    });
  }

  delete(): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'delete', {});
  }
}

interface FilterBuilderState {
  columns?: string;
  insertValues?: Record<string, unknown>[];
  updateValues?: Record<string, unknown>;
  conflictKey?: string;
}

/**
 * Fluent filter / modifier / resolver chain. Implements `then` so `await`
 * on a builder executes the query. Matches the shape of Supabase's
 * `PostgrestFilterBuilder` for the common subset.
 */
export class PostgrestFilterBuilder
  implements PromiseLike<Result<unknown>>
{
  private readonly filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private resolveType: ResolveType = 'many';

  constructor(
    private readonly client: Client,
    private readonly table: string,
    private readonly action: Action,
    private readonly state: FilterBuilderState,
  ) {}

  /* ─── Filters ──────────────────────────────────────────────── */

  eq(column: string, value: unknown): this {
    this.filters.push({ op: '=', column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ op: '!=', column, value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ op: '>', column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ op: '>=', column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ op: '<', column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ op: '<=', column, value });
    return this;
  }

  /** Case-sensitive pattern match. Use `%` as the wildcard. */
  like(column: string, pattern: string): this {
    this.filters.push({ op: 'LIKE', column, value: pattern });
    return this;
  }

  /** Case-insensitive pattern match. Compiled to `LIKE … COLLATE NOCASE`. */
  ilike(column: string, pattern: string): this {
    this.filters.push({ op: 'ILIKE', column, value: pattern });
    return this;
  }

  /** `.is('col', null)` → `col IS NULL`. `.is('col', true/false)` maps to 1/0. */
  is(column: string, value: null | boolean): this {
    if (value === null) {
      this.filters.push({ op: 'IS', column, value: null });
    } else {
      this.filters.push({ op: '=', column, value: value ? 1 : 0 });
    }
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ op: 'IN', column, value: values });
    return this;
  }

  /** Shorthand for stacking `.eq` filters from an object. */
  match(criteria: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(criteria)) {
      this.eq(k, v);
    }
    return this;
  }

  /* ─── Modifiers ────────────────────────────────────────────── */

  order(
    column: string,
    options: { ascending?: boolean } = {},
  ): this {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  /** `[from, to]` inclusive range — equivalent to `LIMIT to-from+1 OFFSET from`. */
  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  /** Require exactly one row; error on 0 or >1. */
  single(): this {
    this.resolveType = 'single';
    return this;
  }

  /** Allow 0 or 1 rows; 0 rows → `data: null`. */
  maybeSingle(): this {
    this.resolveType = 'maybeSingle';
    return this;
  }

  /* ─── Execution ────────────────────────────────────────────── */

  /**
   * Thenable so `await builder` executes the query. This is the same
   * pattern Supabase uses — the chain doesn't hit the network until
   * you `await` (or `.then()`) it.
   */
  then<TFulfilled = Result<unknown>, TRejected = never>(
    onFulfilled?:
      | ((value: Result<unknown>) => TFulfilled | PromiseLike<TFulfilled>)
      | null,
    onRejected?: ((reason: unknown) => TRejected | PromiseLike<TRejected>) | null,
  ): PromiseLike<TFulfilled | TRejected> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private async execute(): Promise<Result<unknown>> {
    let sql: string;
    let params: unknown[];
    try {
      ({ sql, params } = this.buildSql());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return invalidResult(
        new SomewhereError({
          code: 'VALIDATION_ERROR',
          message: msg,
          statusCode: 400,
          retry: false,
          retryAfterMs: null,
        }),
      );
    }
    const projectId = this.client.resolveProjectId();
    try {
      const result = await this.client.call<{
        columns?: string[];
        rows?: Record<string, unknown>[];
      }>('POST', '/db/query', {
        body: { project_id: projectId, sql, params },
      });
      const rows = result?.rows ?? [];
      return this.shapeRows(rows);
    } catch (err) {
      if (err instanceof SomewhereError) {
        return invalidResult(err);
      }
      throw err;
    }
  }

  private shapeRows(rows: Record<string, unknown>[]): Result<unknown> {
    if (this.resolveType === 'single') {
      if (rows.length === 0) {
        return invalidResult(
          new SomewhereError({
            code: 'PGRST116',
            message: 'Single-row query returned 0 rows.',
            statusCode: 406,
            retry: false,
            retryAfterMs: null,
          }),
        );
      }
      if (rows.length > 1) {
        return invalidResult(
          new SomewhereError({
            code: 'PGRST116',
            message: `Single-row query returned ${rows.length} rows.`,
            statusCode: 406,
            retry: false,
            retryAfterMs: null,
          }),
        );
      }
      return { data: rows[0], error: null, count: 1, status: 200 };
    }
    if (this.resolveType === 'maybeSingle') {
      if (rows.length === 0) {
        return { data: null, error: null, count: 0, status: 200 };
      }
      return { data: rows[0], error: null, count: 1, status: 200 };
    }
    return { data: rows, error: null, count: rows.length, status: 200 };
  }

  private buildSql(): { sql: string; params: unknown[] } {
    const table = quoteIdent(this.table);
    const params: unknown[] = [];

    switch (this.action) {
      case 'select': {
        const columns = this.state.columns ?? '*';
        const cols =
          columns.trim() === '*'
            ? '*'
            : splitColumns(columns).map(quoteIdent).join(', ');
        let sql = `SELECT ${cols} FROM ${table}`;
        sql += this.buildWhere(params);
        if (this.orderBy) {
          sql += ` ORDER BY ${quoteIdent(this.orderBy.column)} ${
            this.orderBy.ascending ? 'ASC' : 'DESC'
          }`;
        }
        if (this.limitN != null) sql += ` LIMIT ${Number(this.limitN) | 0}`;
        if (this.offsetN != null) sql += ` OFFSET ${Number(this.offsetN) | 0}`;
        return { sql, params };
      }

      case 'insert':
      case 'upsert': {
        const rows = this.state.insertValues ?? [];
        if (rows.length === 0) {
          throw new Error('insert/upsert: no rows supplied.');
        }
        const cols = Object.keys(rows[0]);
        if (cols.length === 0) {
          throw new Error('insert/upsert: first row has no columns.');
        }
        const colList = cols.map(quoteIdent).join(', ');
        const rowPlaceholders = rows
          .map(() => `(${cols.map(() => '?').join(', ')})`)
          .join(', ');
        for (const row of rows) {
          for (const c of cols) {
            params.push(row[c] ?? null);
          }
        }
        let sql = `INSERT INTO ${table} (${colList}) VALUES ${rowPlaceholders}`;
        if (this.action === 'upsert') {
          const conflict = this.state.conflictKey ?? 'id';
          const conflictCols = conflict
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          const conflictList = conflictCols.map(quoteIdent).join(', ');
          const updateCols = cols.filter((c) => !conflictCols.includes(c));
          if (updateCols.length === 0) {
            sql += ` ON CONFLICT(${conflictList}) DO NOTHING`;
          } else {
            const setList = updateCols
              .map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
              .join(', ');
            sql += ` ON CONFLICT(${conflictList}) DO UPDATE SET ${setList}`;
          }
        }
        sql += ' RETURNING *';
        return { sql, params };
      }

      case 'update': {
        const values = this.state.updateValues ?? {};
        const cols = Object.keys(values);
        if (cols.length === 0) {
          throw new Error('update: no columns supplied.');
        }
        const setList = cols.map((c) => `${quoteIdent(c)} = ?`).join(', ');
        for (const c of cols) params.push(values[c]);
        let sql = `UPDATE ${table} SET ${setList}`;
        sql += this.buildWhere(params);
        sql += ' RETURNING *';
        return { sql, params };
      }

      case 'delete': {
        let sql = `DELETE FROM ${table}`;
        sql += this.buildWhere(params);
        sql += ' RETURNING *';
        return { sql, params };
      }

      default:
        throw new Error(`unknown action: ${this.action as string}`);
    }
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const clauses = this.filters.map((f) => {
      const column = quoteIdent(f.column);
      if (f.op === 'IS' && f.value === null) return `${column} IS NULL`;
      if (f.op === 'IN') {
        const values = f.value as unknown[];
        if (values.length === 0) return '1 = 0';
        const placeholders = values.map(() => '?').join(', ');
        for (const v of values) params.push(v);
        return `${column} IN (${placeholders})`;
      }
      if (f.op === 'ILIKE') {
        params.push(f.value);
        return `${column} LIKE ? COLLATE NOCASE`;
      }
      params.push(f.value);
      return `${column} ${f.op} ?`;
    });
    return ` WHERE ${clauses.join(' AND ')}`;
  }
}
