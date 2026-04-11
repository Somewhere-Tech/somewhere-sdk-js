import type { Client } from '../client.js';

export interface QueuePushInput {
  handler: string;
  payload?: unknown;
  delaySeconds?: number;
}

export class QueueResource {
  constructor(private readonly client: Client) {}

  push(
    input: QueuePushInput,
    projectId?: string,
  ): Promise<{ message_id: string; status: 'queued' }> {
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
