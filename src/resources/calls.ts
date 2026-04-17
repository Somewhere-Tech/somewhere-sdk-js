import type { Client } from '../client.js';
import type {
  CallsSessionCreateRequest,
  CallsSessionCreateResponse,
  Result,
} from '../types.js';

/**
 * Real-time voice/video. A thin passthrough over a global WebRTC SFU —
 * the platform mediates session creation (so the upstream secret stays
 * server-side) and the SDP exchanges flow through unchanged.
 *
 *     const { data } = await sw.calls.createSession()
 *     // → use data.session_id with `addTracks` / `renegotiate` /
 *     //   `closeTracks`. SDP bodies are opaque — pass through whatever
 *     //   the WebRTC layer hands you.
 *
 * Sessions are not persisted by the platform — the developer holds the
 * `session_id` client-side (typical WebRTC UX).
 */
export class CallsClient {
  constructor(private readonly client: Client) {}

  async createSession(input: CallsSessionCreateRequest = {}): Promise<Result<CallsSessionCreateResponse>> {
    const project_id = this.client.requireProjectId(input.projectId, 'calls.createSession');
    return this.client.safeCall<CallsSessionCreateResponse>('POST', '/calls/sessions', {
      auth: 'developer',
      body: { project_id, thirdparty: input.thirdparty },
    });
  }

  /** Add new published or subscribed tracks. SDP body passed through verbatim. */
  async addTracks(sessionId: string, body: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
    return this.client.safeCall<Record<string, unknown>>(
      'POST',
      `/calls/sessions/${encodeURIComponent(sessionId)}/tracks`,
      { auth: 'developer', body },
    );
  }

  /** Renegotiate the SDP for an existing session. */
  async renegotiate(sessionId: string, body: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
    return this.client.safeCall<Record<string, unknown>>(
      'PUT',
      `/calls/sessions/${encodeURIComponent(sessionId)}/renegotiate`,
      { auth: 'developer', body },
    );
  }

  /** Close one or more tracks on a session. */
  async closeTracks(sessionId: string, body: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
    return this.client.safeCall<Record<string, unknown>>(
      'PUT',
      `/calls/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      { auth: 'developer', body },
    );
  }
}
