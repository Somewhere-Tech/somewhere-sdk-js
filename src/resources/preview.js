export class PreviewResource {
    constructor(client) {
        this.client = client;
    }
    invite(email, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/preview/invite', {
            body: { project_id: pid, email },
        });
    }
    revoke(email, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/preview/revoke', {
            body: { project_id: pid, email },
        });
    }
    viewers(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/preview/viewers', {
            query: { project_id: pid },
        });
    }
}
