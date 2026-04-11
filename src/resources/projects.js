export class ProjectsResource {
    constructor(client) {
        this.client = client;
    }
    create(input) {
        return this.client.call('POST', '/projects', { body: input });
    }
    list() {
        return this.client.call('GET', '/projects');
    }
    get(id) {
        return this.client.call('GET', `/projects/${encodeURIComponent(id)}`);
    }
    delete(id) {
        return this.client.call('DELETE', `/projects/${encodeURIComponent(id)}`);
    }
    undeploy(id) {
        return this.client.call('POST', `/projects/${encodeURIComponent(id)}/undeploy`);
    }
    archive(id) {
        return this.client.call('POST', `/projects/${encodeURIComponent(id)}/archive`);
    }
    unarchive(id) {
        return this.client.call('POST', `/projects/${encodeURIComponent(id)}/unarchive`);
    }
    rename(id, input) {
        return this.client.call('PATCH', `/projects/${encodeURIComponent(id)}`, {
            body: input,
        });
    }
    deploys(id) {
        return this.client.call('GET', `/projects/${encodeURIComponent(id)}/deploys`);
    }
}
