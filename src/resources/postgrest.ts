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
 * The SDK sends structured JSON to `POST /v1/db/query`. The server builds
 * the SQL — this SDK never generates or sees any SQL strings.
 */

interface StructuredFilter {
  column: string;
  op: string;
  value: unknown;
}

interface OrderClause {
  column: string;
  ascending: boolean;
}

type ResolveType = 'many' | 'single' | 'maybeSingle';

type Action = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

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
  private readonly filters: StructuredFilter[] = [];
  private orderClause: OrderClause | null = null;
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
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'neq', value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gt', value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value });
    return this;
  }

  /** Case-sensitive pattern match. Use `%` as the wildcard. */
  like(column: string, pattern: string): this {
    this.filters.push({ column, op: 'like', value: pattern });
    return this;
  }

  /** Case-insensitive pattern match. */
  ilike(column: string, pattern: string): this {
    this.filters.push({ column, op: 'ilike', value: pattern });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  /** `.is('col', null)` → IS NULL. `.is('col', true/false)` for booleans. */
  is(column: string, value: null | boolean): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  /** Negate a filter: `.not('status', 'eq', 'archived')`. */
  not(column: string, op: string, value: unknown): this {
    this.filters.push({ column, op: 'not', value: { op, value } });
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
    this.orderClause = { column, ascending: options.ascending ?? true };
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
    const projectId = this.client.resolveProjectId();
    const body = this.buildBody(projectId);

    try {
      const result = await this.client.call<{
        data?: Record<string, unknown>[];
        error?: string | null;
        count?: number;
      }>('POST', '/db/query', { body });

      const rows = result?.data ?? [];
      return this.shapeRows(rows);
    } catch (err) {
      if (err instanceof SomewhereError) {
        return invalidResult(err);
      }
      throw err;
    }
  }

  private buildBody(projectId: string | undefined): Record<string, unknown> {
    const base: Record<string, unknown> = {
      project_id: projectId,
      table: this.table,
    };

    if (this.filters.length > 0) {
      base.filters = this.filters;
    }

    switch (this.action) {
      case 'select': {
        base.select = this.state.columns ?? '*';
        if (this.orderClause) {
          base.order = this.orderClause;
        }
        if (this.limitN != null) {
          base.limit = this.limitN;
        }
        if (this.offsetN != null) {
          base.offset = this.offsetN;
        }
        break;
      }

      case 'insert': {
        const rows = this.state.insertValues ?? [];
        base.insert = rows.length === 1 ? rows[0] : rows;
        break;
      }

      case 'upsert': {
        const rows = this.state.insertValues ?? [];
        base.upsert = rows.length === 1 ? rows[0] : rows;
        base.onConflict = this.state.conflictKey ?? 'id';
        break;
      }

      case 'update': {
        base.update = this.state.updateValues ?? {};
        break;
      }

      case 'delete': {
        base.delete = true;
        break;
      }
    }

    return base;
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
}
