export class StorageResource {
    constructor(client) {
        this.client = client;
    }
    put(key, body, opts = {}, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.putBytes(`/storage/${encodeURIComponent(pid)}/${encodePath(key)}`, body, opts.contentType ?? 'application/octet-stream');
    }
    async get(key, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.getBytes(`/storage/${encodeURIComponent(pid)}/${encodePath(key)}`);
    }
    delete(key, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('DELETE', `/storage/${encodeURIComponent(pid)}/${encodePath(key)}`);
    }
    list(opts = {}, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('GET', '/storage', {
            query: { project_id: pid, prefix: opts.prefix, cursor: opts.cursor },
        });
    }
    requireProjectId(explicit) {
        const pid = this.client.resolveProjectId(explicit);
        if (!pid) {
            throw new Error('storage.* calls require a projectId (via argument or constructor).');
        }
        return pid;
    }
}
function encodePath(key) {
    return key.split('/').map(encodeURIComponent).join('/');
}
