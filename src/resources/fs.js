export class FsResource {
    constructor(client) {
        this.client = client;
    }
    write(path, body, opts = {}, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.putBytes(`/fs/${encodeURIComponent(pid)}/${encodePath(path)}`, body, opts.contentType ?? 'application/octet-stream');
    }
    /**
     * Read a file or directory. Returns `{body, contentType}` for files, or
     * `{type: 'directory', entries}` when the path is a directory.
     */
    async read(path, projectId) {
        const pid = this.requireProjectId(projectId);
        const result = await this.client.getBytes(`/fs/${encodeURIComponent(pid)}/${encodePath(path)}`);
        // Directory responses come back as JSON; files as raw bytes.
        if (result.contentType.includes('application/json')) {
            const text = new TextDecoder().decode(result.body);
            const parsed = JSON.parse(text);
            if (parsed.ok && parsed.data && parsed.data.type === 'directory') {
                return parsed.data;
            }
        }
        return result;
    }
    delete(path, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('DELETE', `/fs/${encodeURIComponent(pid)}/${encodePath(path)}`);
    }
    move(from, to, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/move`, {
            body: { from, to },
        });
    }
    copy(from, to, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/copy`, {
            body: { from, to },
        });
    }
    stat(path, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('GET', `/fs/${encodeURIComponent(pid)}/stat/${encodePath(path)}`);
    }
    versions(path, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('GET', `/fs/${encodeURIComponent(pid)}/versions/${encodePath(path)}`);
    }
    restore(path, version, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', `/fs/${encodeURIComponent(pid)}/restore`, {
            body: { path, version },
        });
    }
    requireProjectId(explicit) {
        const pid = this.client.resolveProjectId(explicit);
        if (!pid) {
            throw new Error('fs.* calls require a projectId (via argument or constructor).');
        }
        return pid;
    }
}
function encodePath(path) {
    const trimmed = path.startsWith('/') ? path.slice(1) : path;
    return trimmed.split('/').map(encodeURIComponent).join('/');
}
