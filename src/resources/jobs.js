export class JobsResource {
    constructor(client) {
        this.client = client;
    }
    create(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/jobs', {
            body: {
                project_id: pid,
                handler: input.handler,
                payload: input.payload,
                webhook_url: input.webhookUrl,
                timeout_seconds: input.timeoutSeconds,
                priority: input.priority,
            },
        });
    }
    status(jobId) {
        return this.client.call('GET', `/jobs/${encodeURIComponent(jobId)}`);
    }
    list(query = {}, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/jobs', {
            query: { project_id: pid, status: query.status, limit: query.limit },
        });
    }
    cancel(jobId) {
        return this.client.call('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`);
    }
    progress(jobId, input) {
        return this.client.call('POST', `/jobs/${encodeURIComponent(jobId)}/progress`, {
            body: { progress: input.progress, message: input.message },
        });
    }
}
