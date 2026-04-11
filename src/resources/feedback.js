export class FeedbackResource {
    constructor(client) {
        this.client = client;
    }
    submit(input, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', `/projects/${encodeURIComponent(pid)}/feedback`, {
            body: {
                message: input.message,
                page_url: input.pageUrl,
                screenshot_url: input.screenshotUrl,
            },
        });
    }
    list(projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('GET', `/projects/${encodeURIComponent(pid)}/feedback`);
    }
    requireProjectId(explicit) {
        const pid = this.client.resolveProjectId(explicit);
        if (!pid) {
            throw new Error('feedback.* calls require a projectId (via argument or constructor).');
        }
        return pid;
    }
}
