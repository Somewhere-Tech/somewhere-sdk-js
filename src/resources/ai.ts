import type { Client } from '../client.js';
import type { AiCompleteMessage, AiCompleteResult } from '../types.js';

export interface AiCompleteInput {
  provider?: string;
  model?: string;
  messages: AiCompleteMessage[];
  system?: string;
  maxTokens?: number;
}

export interface AiEmbedInput {
  provider?: string;
  model?: string;
  input: string | string[];
}

export interface AiImageInput {
  provider?: string;
  model?: string;
  prompt: string;
  size?: string;
  n?: number;
}

export interface AiTtsInput {
  provider?: string;
  model?: string;
  input: string;
  voice?: string;
}

export interface AiTranscribeInput {
  provider?: string;
  model?: string;
  file: BodyInit;
  language?: string;
}

export class AiResource {
  constructor(private readonly client: Client) {}

  complete(input: AiCompleteInput, projectId?: string): Promise<AiCompleteResult> {
    const pid = this.client.resolveProjectId(projectId);
    return this.client.call<AiCompleteResult>('POST', '/ai/complete', {
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
  embed(input: AiEmbedInput, projectId?: string): Promise<unknown> {
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
  image(input: AiImageInput, projectId?: string): Promise<unknown> {
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
  tts(input: AiTtsInput, projectId?: string): Promise<unknown> {
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
  transcribe(input: AiTranscribeInput, projectId?: string): Promise<unknown> {
    const pid = this.client.resolveProjectId(projectId);
    // Multipart form-data upload when the endpoint ships.
    const form = new FormData();
    form.append('project_id', pid ?? '');
    if (input.provider) form.append('provider', input.provider);
    if (input.model) form.append('model', input.model);
    if (input.language) form.append('language', input.language);
    form.append('file', input.file as Blob);
    return this.client.call('POST', '/ai/transcribe', { body: form });
  }
}
