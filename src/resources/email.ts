import type { Client } from '../client.js';

export interface EmailSendInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

export class EmailResource {
  constructor(private readonly client: Client) {}

  send(
    input: EmailSendInput,
    projectId?: string,
  ): Promise<{ sent: true; id: string }> {
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
