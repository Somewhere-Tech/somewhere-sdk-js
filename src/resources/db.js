export class DbResource {
    constructor(client) {
        this.client = client;
    }
    /**
     * Run a parameterized SQL query against this project's D1.
     * Dual-auth: accepts developer key OR app-user JWT.
     */
    query(sql, params, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/db/query', {
            body: { project_id: pid, sql, params },
        });
    }
    /** Multi-statement DDL. Developer key only. */
    migrate(sql, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/db/migrate', {
            body: { project_id: pid, sql },
        });
    }
    tables(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/db/tables', {
            query: { project_id: pid },
        });
    }
    schema(table, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/db/schema', {
            query: { project_id: pid, table },
        });
    }
}
