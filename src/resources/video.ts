import type { Client } from '../client.js';
import type {
  Result,
  VideoListResponse,
  VideoObject,
  VideoUploadUrlRequest,
  VideoUploadUrlResponse,
} from '../types.js';

/**
 * Video upload + playback. The platform issues a one-time direct upload
 * URL — bytes go straight from the user's browser to the upstream
 * delivery network, never through the platform — then exposes
 * playback URLs (HLS + DASH) and a thumbnail once the video is ready.
 *
 *     // 1. Get a one-time upload URL (server side).
 *     const { data } = await sw.video.createUploadUrl({ title: 'demo' })
 *     // 2. POST the file bytes to data.upload_url from the browser.
 *     // 3. Poll for readiness.
 *     const v = await sw.video.get(data.video_id)
 *     if (v.data?.ready) play(v.data.hls_url)
 */
export class VideoClient {
  constructor(private readonly client: Client) {}

  async createUploadUrl(input: VideoUploadUrlRequest = {}): Promise<Result<VideoUploadUrlResponse>> {
    const project_id = this.client.requireProjectId(input.projectId, 'video.createUploadUrl');
    return this.client.safeCall<VideoUploadUrlResponse>('POST', '/video/upload-url', {
      auth: 'developer',
      body: {
        project_id,
        title: input.title,
        max_duration_seconds: input.max_duration_seconds,
        require_signed_urls: input.require_signed_urls,
      },
    });
  }

  async list(opts: { projectId?: string; limit?: number } = {}): Promise<Result<VideoListResponse>> {
    const project_id = this.client.requireProjectId(opts.projectId, 'video.list');
    return this.client.safeCall<VideoListResponse>('GET', '/video', {
      auth: 'developer',
      query: { project_id, limit: opts.limit },
    });
  }

  async get(id: string): Promise<Result<VideoObject>> {
    return this.client.safeCall<VideoObject>('GET', `/video/${encodeURIComponent(id)}`, {
      auth: 'developer',
    });
  }

  async delete(id: string): Promise<Result<{ id: string; deleted: true }>> {
    return this.client.safeCall<{ id: string; deleted: true }>(
      'DELETE',
      `/video/${encodeURIComponent(id)}`,
      { auth: 'developer' },
    );
  }
}
