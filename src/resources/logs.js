export class LogsResource {
    constructor(client) {
        this.client = client;
    }
    write(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/logs', {
            body: {
                project_id: pid,
                level: input.level,
                message: input.message,
                data: input.data,
            },
        });
    }
    read(query = {}, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('GET', '/logs', {
            query: { project_id: pid, ...query },
        });
    }
}
