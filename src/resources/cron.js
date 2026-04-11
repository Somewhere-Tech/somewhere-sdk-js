export class CronResource {
    constructor(client) {
        this.client = client;
    }
    create(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/cron', {
            body: {
                project_id: pid,
                schedule: input.schedule,
                handler: input.handler,
                payload: input.payload,
                name: input.name,
                enabled: input.enabled,
            },
        });
    }
    list(projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/cron', { query: { project_id: pid } });
    }
    update(id, input) {
        return this.client.call('PATCH', `/cron/${encodeURIComponent(id)}`, {
            body: {
                schedule: input.schedule,
                handler: input.handler,
                payload: input.payload,
                enabled: input.enabled,
                name: input.name,
            },
        });
    }
    delete(id) {
        return this.client.call('DELETE', `/cron/${encodeURIComponent(id)}`);
    }
}
