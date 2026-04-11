export class UsageResource {
    constructor(client) {
        this.client = client;
    }
    get(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/usage', {
            query: { project_id: pid, period: '30d' },
        });
    }
    summary() {
        return this.client.call('GET', '/usage/summary');
    }
}
