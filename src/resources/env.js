export class EnvResource {
    constructor(client) {
        this.client = client;
    }
    set(key, value, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/env', {
            body: { project_id: pid, key, value },
        });
    }
    list(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/env', { query: { project_id: pid } });
    }
    delete(key, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        if (!pid) {
            throw new Error('env.delete requires a projectId (via argument or constructor).');
        }
        return this.client.call('DELETE', `/env/${encodeURIComponent(pid)}/${encodeURIComponent(key)}`);
    }
}
