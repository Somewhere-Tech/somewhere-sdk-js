import type { Client } from '../client.js';
import type { Result, SendEmailRequest, SendEmailResponse } from '../types.js';

/**
 * Resend-style email client. Matches `resend.emails.send({...})` exactly,
 * including the `{ from, to, subject, html, text, reply_to, cc, bcc }`
 * body shape and the `{ data, error }` return envelope.
 *
 *     const { data, error } = await sw.emails.send({
 *       from: 'noreply@myapp.com',
 *       to: 'user@example.com',
 *       subject: 'Welcome!',
 *       html: '<h1>Welcome</h1>',
 *     })
 */
export class EmailsClient {
  constructor(private readonly client: Client) {}

  async send(
    input: SendEmailRequest,
  ): Promise<Result<SendEmailResponse>> {
    const projectId = this.client.requireProjectId(undefined, 'emails.send');
    return this.client.safeCall<SendEmailResponse>('POST', '/email/send', {
      auth: 'developer',
      body: {
        project_id: projectId,
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.reply_to,
        cc: input.cc,
        bcc: input.bcc,
      },
    });
  }
}
