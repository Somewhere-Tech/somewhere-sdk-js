import type { Client } from '../client.js';
import { SomewhereError } from '../errors.js';
import type { Result } from '../types.js';

/**
 * Per-project ticketing. Lightweight task tracking (think GitHub
 * Issues but inside your project) with optional webhook + email
 * notifications. Free and unlimited.
 *
 *     const t = await sw.tasks.create({
 *       title: 'Wire up payments',
 *       priority: 'high',
 *       labels: ['billing'],
 *     });
 *     await sw.tasks.update(t.data!.id, { status: 'done' });
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'wont_fix';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assignee?: string | null;
  reporter?: string | null;
  labels?: string[];
  due_at?: number | null;
  area?: string | null;
  parent_id?: string | null;
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
}

export interface TaskListOptions {
  projectId?: string;
  status?: Task['status'] | Task['status'][];
  priority?: Task['priority'] | Task['priority'][];
  assignee?: string;
  area?: string;
  labels?: string[];
  limit?: number;
  cursor?: string;
}

export interface CreateTaskInput {
  projectId?: string;
  title: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  assignee?: string;
  labels?: string[];
  due_at?: number | string;
  area?: string;
  parent_id?: string;
}

export interface UpdateTaskInput {
  projectId?: string;
  title?: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  assignee?: string | null;
  labels?: string[];
  due_at?: number | string | null;
  area?: string | null;
  parent_id?: string | null;
  resolution_note?: string;
}

export class TasksClient {
  constructor(private readonly client: Client) {}

  async create(input: CreateTaskInput): Promise<Result<Task>> {
    const projectId = this.client.requireProjectId(input.projectId, 'tasks.create');
    const { projectId: _omit, ...rest } = input;
    try {
      const result = await this.client.call<Task>('POST', '/tasks', {
        body: { project_id: projectId, ...rest },
      });
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  async list(options: TaskListOptions = {}): Promise<Result<Task[]>> {
    const projectId = this.client.requireProjectId(options.projectId, 'tasks.list');
    const q = new URLSearchParams({ project_id: projectId });
    if (options.status) {
      const v = Array.isArray(options.status) ? options.status[0] : options.status;
      if (v) q.set('status', v);
    }
    if (options.assignee) q.set('assignee', options.assignee);
    if (options.area) q.set('area', options.area);
    if (options.limit != null) q.set('limit', String(options.limit));
    try {
      const result = await this.client.call<Task[] | { tasks?: Task[] }>(
        'GET',
        `/tasks?${q}`,
      );
      const data = Array.isArray(result) ? result : (result?.tasks ?? []);
      return { data, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  async get(id: string, options: { projectId?: string } = {}): Promise<Result<Task>> {
    const projectId = this.client.requireProjectId(options.projectId, 'tasks.get');
    try {
      const result = await this.client.call<Task>(
        'GET',
        `/tasks/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  async update(id: string, input: UpdateTaskInput): Promise<Result<Task>> {
    const projectId = this.client.requireProjectId(input.projectId, 'tasks.update');
    const { projectId: _omit, ...rest } = input;
    try {
      const result = await this.client.call<Task>('PATCH', `/tasks/${encodeURIComponent(id)}`, {
        body: { project_id: projectId, ...rest },
      });
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  async delete(id: string, options: { projectId?: string } = {}): Promise<Result<{ deleted: true }>> {
    const projectId = this.client.requireProjectId(options.projectId, 'tasks.delete');
    try {
      await this.client.call(
        'DELETE',
        `/tasks/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
      );
      return { data: { deleted: true }, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }

  async comment(
    id: string,
    body: string,
    options: { projectId?: string } = {},
  ): Promise<Result<{ id: string; created_at: number }>> {
    const projectId = this.client.requireProjectId(options.projectId, 'tasks.comment');
    try {
      const result = await this.client.call<{ id: string; created_at: number }>(
        'POST',
        `/tasks/${encodeURIComponent(id)}/comments`,
        { body: { project_id: projectId, body } },
      );
      return { data: result, error: null, status: 200 };
    } catch (err) {
      return toResultError(err);
    }
  }
}

function arr<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

function toResultError<T>(err: unknown): Result<T> {
  if (err instanceof SomewhereError) {
    return { data: null, error: err, status: err.statusCode };
  }
  throw err;
}
