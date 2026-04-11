import type { Client } from '../client.js';

export interface FeedbackSubmitInput {
  message: string;
  screenshotUrl?: string;
  pageUrl?: string;
}

export interface FeedbackRecord {
  id: string;
  user_id: string;
  message: string;
  page_url?: string | null;
  screenshot_url?: string | null;
  created_at: string;
  [k: string]: unknown;
}

export class FeedbackResource {
  constructor(private readonly client: Client) {}

  submit(input: FeedbackSubmitInput, projectId?: string): Promise<{ submitted: true }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('POST', `/projects/${encodeURIComponent(pid)}/feedback`, {
      body: {
        message: input.message,
        page_url: input.pageUrl,
        screenshot_url: input.screenshotUrl,
      },
    });
  }

  list(projectId?: string): Promise<{ feedback: FeedbackRecord[] }> {
    const pid = this.requireProjectId(projectId);
    return this.client.call('GET', `/projects/${encodeURIComponent(pid)}/feedback`);
  }

  private requireProjectId(explicit?: string): string {
    const pid = this.client.resolveProjectId(explicit);
    if (!pid) {
      throw new Error('feedback.* calls require a projectId (via argument or constructor).');
    }
    return pid;
  }
}
