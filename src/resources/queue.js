export class QueueResource {
    constructor(client) {
        this.client = client;
    }
    push(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/queue', {
            body: {
                project_id: pid,
                handler: input.handler,
                payload: input.payload,
                delay_seconds: input.delaySeconds,
            },
        });
    }
}
