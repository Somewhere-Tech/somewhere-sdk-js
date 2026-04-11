export class EmailResource {
    constructor(client) {
        this.client = client;
    }
    send(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/email/send', {
            body: {
                project_id: pid,
                to: input.to,
                subject: input.subject,
                html: input.html,
                text: input.text,
                from: input.from,
            },
        });
    }
}
