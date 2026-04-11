import type { Client } from '../client.js';
import type { ChatCompletion, ChatCompletionRequest } from '../types.js';

/**
 * OpenAI-style `chat.completions.create(...)`. Unlike every other
 * surface on the Somewhere SDK, this one THROWS on error instead of
 * returning a `{data, error}` envelope — matching the behaviour of the
 * official OpenAI Node client exactly.
 *
 *     const completion = await sw.chat.completions.create({
 *       model: 'gpt-5.4',
 *       messages: [{ role: 'user', content: 'Hello' }],
 *     })
 *     const text = completion.choices[0].message.content
 */
export class ChatClient {
  readonly completions: ChatCompletionsClient;
  constructor(client: Client) {
    this.completions = new ChatCompletionsClient(client);
  }
}

export class ChatCompletionsClient {
  constructor(private readonly client: Client) {}

  async create(request: ChatCompletionRequest): Promise<ChatCompletion> {
    const projectId = this.client.requireProjectId(
      undefined,
      'chat.completions.create',
    );
    const raw = await this.client.call<RawCompletion>('POST', '/ai/complete', {
      auth: 'developer',
      body: {
        project_id: projectId,
        provider: request.provider,
        model: request.model,
        messages: request.messages,
        system: request.system,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      },
    });
    return reshapeCompletion(raw, request.model);
  }
}

interface RawCompletion {
  content: string;
  model: string;
  provider: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function reshapeCompletion(raw: RawCompletion, requestedModel: string): ChatCompletion {
  const inputTokens = raw.usage?.input_tokens ?? 0;
  const outputTokens = raw.usage?.output_tokens ?? 0;
  return {
    id: `chatcmpl-${generateId()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: raw.model ?? requestedModel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: raw.content ?? '' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

function generateId(): string {
  // 24-char base36 id, matches the shape of OpenAI's chatcmpl IDs close
  // enough that consumers who log/store them see a familiar prefix.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return out.slice(0, 24);
}
