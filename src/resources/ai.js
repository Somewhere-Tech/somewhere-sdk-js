export class AiResource {
    constructor(client) {
        this.client = client;
    }
    complete(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/ai/complete', {
            body: {
                project_id: pid,
                provider: input.provider,
                model: input.model,
                messages: input.messages,
                system: input.system,
                max_tokens: input.maxTokens,
            },
        });
    }
    /** Not yet implemented on the platform. Will return UNSUPPORTED_FEATURE until shipped. */
    embed(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/ai/embed', {
            body: {
                project_id: pid,
                provider: input.provider,
                model: input.model,
                input: input.input,
            },
        });
    }
    /** Not yet implemented on the platform. Will return UNSUPPORTED_FEATURE until shipped. */
    image(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/ai/generate-image', {
            body: {
                project_id: pid,
                provider: input.provider,
                model: input.model,
                prompt: input.prompt,
                size: input.size,
                n: input.n,
            },
        });
    }
    /** Not yet implemented on the platform. Will return UNSUPPORTED_FEATURE until shipped. */
    tts(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        return this.client.call('POST', '/ai/tts', {
            body: {
                project_id: pid,
                provider: input.provider,
                model: input.model,
                input: input.input,
                voice: input.voice,
            },
        });
    }
    /** Not yet implemented on the platform. Will return UNSUPPORTED_FEATURE until shipped. */
    transcribe(input, projectId) {
        const pid = this.client.resolveProjectId(projectId);
        // Multipart form-data upload when the endpoint ships.
        const form = new FormData();
        form.append('project_id', pid ?? '');
        if (input.provider)
            form.append('provider', input.provider);
        if (input.model)
            form.append('model', input.model);
        if (input.language)
            form.append('language', input.language);
        form.append('file', input.file);
        return this.client.call('POST', '/ai/transcribe', { body: form });
    }
}
