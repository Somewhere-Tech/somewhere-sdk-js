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

/** Count mode for `select(cols, { count })`. Matches `@supabase/supabase-js`. */
export type CountMode = 'exact' | 'planned' | 'estimated';

/** A foreign-key embed parsed out of a nested select like `profile(*)`. */
interface EmbedSpec {
  /** Key the embedded result is attached under (the alias, or the table name). */
  alias: string;
  /** The related table to read from. */
  table: string;
  /** The columns to select on the embedded resource (`*` or a column list). */
  columns: string;
}

/** Naive singularizer matching the server's table→interface convention. */
function singularize(name: string): string {
  return name.endsWith('s') && !name.endsWith('ss') ? name.slice(0, -1) : name;
}

/**
 * Split a select string into base columns + foreign-key embeds.
 *
 *   '*, profile(*), posts(id, title)'
 *     → { baseColumns: '*', embeds: [
 *         { alias: 'profile', table: 'profile', columns: '*' },
 *         { alias: 'posts',   table: 'posts',   columns: 'id, title' } ] }
 *
 * Embeds use Supabase's syntax: `table(cols)` or `alias:table(cols)`.
 */
function parseSelect(select: string): { baseColumns: string; embeds: EmbedSpec[] } {
  const baseCols: string[] = [];
  const embeds: EmbedSpec[] = [];
  for (const raw of splitTopLevel(select)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(part);
    if (m) {
      embeds.push({ alias: m[1] || m[2], table: m[2], columns: m[3].trim() || '*' });
    } else {
      baseCols.push(part);
    }
  }
  return {
    baseColumns: baseCols.length > 0 ? baseCols.join(', ') : '*',
    embeds,
  };
}

/** Add a column to a flat column list if it isn't already there. */
function ensureColumn(columns: string, col: string): string {
  if (columns === '*' || columns.includes('(')) return columns;
  const cols = columns.split(',').map((s) => s.trim()).filter(Boolean);
  if (!cols.includes(col)) cols.push(col);
  return cols.join(', ');
}

/** Drop a join key we injected for stitching but the caller didn't ask for. */
function stripInjectedColumn(
  rows: Record<string, unknown>[],
  requestedCols: string,
  injectedCol: string,
): void {
  if (requestedCols === '*' || requestedCols.includes('(')) return;
  const requested = new Set(requestedCols.split(',').map((s) => s.trim()).filter(Boolean));
  if (requested.has(injectedCol)) return;
  for (const r of rows) delete r[injectedCol];
}

function invalidResult<T>(err: SomewhereError): Result<T> {
  return { data: null, error: err, count: null, status: err.statusCode };
}

/** Split on top-level commas only — commas inside `(...)` (an `in` list) stay. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Coerce an `.or()` string value to its JSON type (number / bool / null / string). */
function coerceFilterValue(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d*\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw;
}

/** What `.from(...)` returns — pre-action chain. */
export class SomewhereQueryBuilder {
  constructor(
    private readonly client: Client,
    private readonly table: string,
  ) {}

  /**
   * Select rows. Pass embeds in the column string for foreign-key joins
   * (`select('*, profile(*)')`), and `{ count, head }` for counts:
   *
   *     // total rows matching the filters, alongside the page of data
   *     const { data, count } = await sw.from('todos')
   *       .select('*', { count: 'exact' }).eq('done', false).limit(20)
   *
   *     // just the count, no rows fetched
   *     const { count } = await sw.from('todos')
   *       .select('*', { count: 'exact', head: true }).eq('done', false)
   */
  select(
    columns = '*',
    options: { count?: CountMode; head?: boolean } = {},
  ): PostgrestFilterBuilder {
    return new PostgrestFilterBuilder(this.client, this.table, 'select', {
      columns,
      count: options.count,
      head: options.head,
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
  count?: CountMode;
  head?: boolean;
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

  /** Base columns (embeds stripped out) sent to the server. */
  private readonly baseColumns: string;
  /** Foreign-key embeds resolved client-side after the base query. */
  private readonly embeds: EmbedSpec[];
  private readonly countMode: CountMode | null;
  private readonly headOnly: boolean;

  constructor(
    private readonly client: Client,
    private readonly table: string,
    private readonly action: Action,
    private readonly state: FilterBuilderState,
  ) {
    if (action === 'select') {
      const parsed = parseSelect(state.columns ?? '*');
      this.baseColumns = parsed.baseColumns;
      this.embeds = parsed.embeds;
    } else {
      this.baseColumns = state.columns ?? '*';
      this.embeds = [];
    }
    this.countMode = state.count ?? null;
    this.headOnly = state.head ?? false;
  }

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

  /**
   * OR a set of conditions (Supabase syntax). `.or('status.eq.active,age.gt.18')`
   * → `(status = 'active' OR age > 18)`, AND-ed with any other filters.
   * Each term is `column.operator.value`; `in` uses `col.in.(a,b,c)`. Numeric /
   * `true` / `false` / `null` values are coerced to their JSON types.
   */
  or(filters: string): this {
    const subs: StructuredFilter[] = [];
    for (const raw of splitTopLevel(filters)) {
      const term = raw.trim();
      if (!term) continue;
      // `in` values contain commas inside (...), so detect+consume them first.
      const inMatch = /^([A-Za-z_][A-Za-z0-9_]*)\.in\.\((.*)\)$/.exec(term);
      if (inMatch) {
        subs.push({
          column: inMatch[1],
          op: 'in',
          value: inMatch[2].split(',').map((v) => coerceFilterValue(v.trim())),
        });
        continue;
      }
      const firstDot = term.indexOf('.');
      const secondDot = term.indexOf('.', firstDot + 1);
      if (firstDot < 0 || secondDot < 0) continue; // malformed term — skip
      subs.push({
        column: term.slice(0, firstDot),
        op: term.slice(firstDot + 1, secondDot),
        value: coerceFilterValue(term.slice(secondDot + 1)),
      });
    }
    this.filters.push({ column: '', op: 'or', value: subs });
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

      const serverCount = typeof result?.count === 'number' ? result.count : null;

      // head:true → the count only, no rows (Supabase HEAD semantics).
      if (this.headOnly) {
        return { data: null, error: null, count: serverCount, status: 200 };
      }

      const rows = result?.data ?? [];

      // Nested FK select — resolve each embed against the rows we got back,
      // then narrow to the requested base columns.
      if (this.action === 'select' && this.embeds.length > 0 && rows.length > 0) {
        await this.resolveEmbeds(rows);
        this.projectBaseColumns(rows);
      }

      return this.shapeRows(rows, serverCount);
    } catch (err) {
      if (err instanceof SomewhereError) {
        return invalidResult(err);
      }
      throw err;
    }
  }

  /**
   * Resolve every foreign-key embed by issuing one follow-up query per
   * embed through the same `/db/query` path (so per-table user scoping
   * still applies), then stitching the results onto the base rows.
   *
   * Relationship direction is inferred from the data, by convention:
   *   - belongs-to (object): the base row has `<embed>_id` / `<embed-singular>_id`.
   *     The embed is fetched by its `id` and attached as a single object.
   *   - has-many (array): otherwise the child table is assumed to carry
   *     `<base-singular>_id`; matching rows are attached as an array.
   */
  private async resolveEmbeds(rows: Record<string, unknown>[]): Promise<void> {
    await Promise.all(this.embeds.map((embed) => this.resolveOneEmbed(rows, embed)));
  }

  private async resolveOneEmbed(
    rows: Record<string, unknown>[],
    embed: EmbedSpec,
  ): Promise<void> {
    const sample = rows[0];
    const belongsToFk =
      `${singularize(embed.table)}_id` in sample
        ? `${singularize(embed.table)}_id`
        : `${embed.table}_id` in sample
          ? `${embed.table}_id`
          : null;

    if (belongsToFk) {
      // belongs-to: base.<fk> → embed.id, attached as a single object.
      const ids = [...new Set(rows.map((r) => r[belongsToFk]).filter((v) => v != null))];
      const map = new Map<unknown, Record<string, unknown>>();
      if (ids.length > 0) {
        const res = await new PostgrestFilterBuilder(this.client, embed.table, 'select', {
          columns: ensureColumn(embed.columns, 'id'),
        }).in('id', ids);
        const erows = ((res.data as Record<string, unknown>[] | null) ?? []);
        // Key the map by id BEFORE stripping an injected id off the rows.
        for (const er of erows) map.set(er.id, er);
        stripInjectedColumn(erows, embed.columns, 'id');
      }
      for (const r of rows) r[embed.alias] = map.get(r[belongsToFk]) ?? null;
      return;
    }

    // has-many: embed.<base-singular>_id → base.id, attached as an array.
    const fk = `${singularize(this.table)}_id`;
    const baseIds = [...new Set(rows.map((r) => r.id).filter((v) => v != null))];
    const groups = new Map<unknown, Record<string, unknown>[]>();
    if (baseIds.length > 0) {
      const res = await new PostgrestFilterBuilder(this.client, embed.table, 'select', {
        columns: ensureColumn(embed.columns, fk),
      }).in(fk, baseIds);
      const erows = ((res.data as Record<string, unknown>[] | null) ?? []);
      for (const er of erows) {
        const key = er[fk];
        const arr = groups.get(key) ?? [];
        arr.push(er);
        groups.set(key, arr);
      }
      stripInjectedColumn(erows, embed.columns, fk);
    }
    for (const r of rows) r[embed.alias] = groups.get(r.id) ?? [];
  }

  /** Drop base columns the caller didn't request (we fetched `*` for embeds). */
  private projectBaseColumns(rows: Record<string, unknown>[]): void {
    if (this.baseColumns === '*') return;
    const keep = new Set(this.baseColumns.split(',').map((s) => s.trim()).filter(Boolean));
    for (const e of this.embeds) keep.add(e.alias);
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (!keep.has(k)) delete row[k];
      }
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
        // With embeds we fetch all base columns (so the join keys are
        // present) and project down client-side after stitching.
        base.select = this.embeds.length > 0 ? '*' : this.baseColumns;
        if (this.orderClause) {
          base.order = this.orderClause;
        }
        if (this.limitN != null) {
          base.limit = this.limitN;
        }
        if (this.offsetN != null) {
          base.offset = this.offsetN;
        }
        if (this.countMode) {
          base.count = this.countMode;
        }
        if (this.headOnly) {
          base.head = true;
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

  private shapeRows(
    rows: Record<string, unknown>[],
    serverCount: number | null,
  ): Result<unknown> {
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
      return { data: rows[0], error: null, count: serverCount ?? 1, status: 200 };
    }
    if (this.resolveType === 'maybeSingle') {
      if (rows.length === 0) {
        return { data: null, error: null, count: serverCount ?? 0, status: 200 };
      }
      return { data: rows[0], error: null, count: serverCount ?? 1, status: 200 };
    }
    return { data: rows, error: null, count: serverCount ?? rows.length, status: 200 };
  }
}
