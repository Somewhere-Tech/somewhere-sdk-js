import type { Client } from '../client.js';
import type { DbQueryResult, DbSchema, DbTables } from '../types.js';

export class DbResource {
  constructor(private readonly client: Client) {}

  /**
   * Run a parameterized SQL query against this project's D1.
   * Dual-auth: accepts developer key OR app-user JWT.
   */
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    projectId?: string,
  ): Promise<DbQueryResult<Row>> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call<DbQueryResult<Row>>('POST', '/db/query', {
      body: { project_id: pid, sql, params },
    });
  }

  /** Multi-statement DDL. Developer key only. */
  migrate(
    sql: string,
    projectId?: string,
  ): Promise<{ statements_run: number; results: unknown[] }> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call('POST', '/db/migrate', {
      body: { project_id: pid, sql },
    });
  }

  tables(projectId?: string): Promise<DbTables> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call<DbTables>('GET', '/db/tables', {
      query: { project_id: pid },
    });
  }

  schema(table: string, projectId?: string): Promise<DbSchema> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call<DbSchema>('GET', '/db/schema', {
      query: { project_id: pid, table },
    });
  }
}
