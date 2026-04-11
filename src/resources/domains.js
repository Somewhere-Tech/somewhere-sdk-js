export class DomainsResource {
    constructor(client) {
        this.client = client;
    }
    add(domain, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/domains/add', {
            body: { project_id: pid, domain },
        });
    }
    verify(domain, _projectId) {
        return this.client.call('GET', '/domains/verify', { query: { domain } });
    }
    list(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/domains', { query: { project_id: pid } });
    }
    delete(domain, _projectId) {
        return this.client.call('DELETE', `/domains/${encodeURIComponent(domain)}`);
    }
}
