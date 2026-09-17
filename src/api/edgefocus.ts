import { loadConfig, loadToken, redact, type AppConfig } from '../config/index.js';
import type {
  EFBucket,
  EFProjectView,
  EFCreateTaskPayload,
  EFTask,
  EFTaskAssginee,
  EFTaskBucket,
  EFUser
} from '../types/edgefocus.js';

export type ErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'network'
  | 'unknown';

export class EdgeFocusError extends Error {
  kind: ErrorKind;
  status?: number;
  /** Safe-to-show technical detail (token already redacted). */
  detail?: string;
  constructor(kind: ErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'EdgeFocusError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const FRIENDLY: Record<number, string> = {
  400: 'Request rejected by EdgeFocus.',
  401: 'Authentication failed. Check EDGEFOCUS_TOKEN.',
  403: 'No access to this EdgeFocus project.',
  404: 'Project/view/task not found.',
  500: 'EdgeFocus server error. Try again.'
};

function kindFor(status: number): ErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 412 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Pull the most useful message out of an EdgeFocus/Vikunja error body. */
function apiMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const msg = b.message ?? b.error ?? b.error_message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  return undefined;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

export class EdgeFocusClient {
  readonly config: AppConfig;
  private readonly token: string;

  constructor(config?: AppConfig, token?: string) {
    this.config = config ?? loadConfig();
    this.token = token ?? loadToken();
  }

  /**
   * Auth per docs.json securityDefinitions.JWTKeyAuth:
   *   { "type": "apiKey", "name": "Authorization", "in": "header" }
   * EdgeFocus/Vikunja expects the `Bearer ` prefix for both JWT and API tokens.
   */
  private authHeader(): string {
    return /^bearer\s/i.test(this.token) ? this.token : `Bearer ${this.token}`;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, timeoutMs = 20000 } = opts;
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const aborted = controller.signal.aborted;
      throw new EdgeFocusError(
        'network',
        aborted
          ? 'Could not connect to EdgeFocus (request timed out).'
          : 'Could not connect to EdgeFocus.',
        undefined,
        redact(`${method} ${url.pathname} — ${raw}`, this.token)
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      const api = apiMessage(parsed);
      let base = FRIENDLY[res.status] ?? `EdgeFocus returned HTTP ${res.status}.`;
      if (res.status === 401) {
        base +=
          ' Сервер отклонил токен. Проверьте, что он не истёк и что в его permissions' +
          ' отмечены нужные разделы (Projects, Tasks, Buckets/Views).';
      }
      if (res.status === 403) {
        base +=
          ' Возможно, у API-токена нет прав на этот раздел — пересоздайте его,' +
          ' отметив все permissions.';
      }
      const message = res.status === 400 && api ? `${base} ${api}` : base;
      const detail = redact(
        `${method} ${url.pathname}${url.search} -> ${res.status}\n${text.slice(0, 2000)}`,
        this.token
      );
      throw new EdgeFocusError(kindFor(res.status), message, res.status, detail);
    }

    return parsed as T;
  }

  // ---- endpoints (exactly as defined in docs.json) ----

  /**
   * GET /projects — the cheapest token check that actually works with API
   * tokens. (`GET /user` needs a browser session, not an API token, so it
   * always answers 401 here even for a perfectly valid token.)
   */
  getProjects() {
    return this.list<{ id: number; title: string }>(`/projects`);
  }

  /** GET /projects/{id} */
  getProject(projectId = this.config.projectId) {
    return this.request<{ id: number; title: string }>(`/projects/${projectId}`);
  }

  /** GET /projects/{project}/views/{id} */
  getView(viewId = this.config.kanbanViewId, projectId = this.config.projectId) {
    return this.request<EFProjectView>(`/projects/${projectId}/views/${viewId}`);
  }

  /** GET /projects/{id}/views/{view}/buckets */
  getBuckets(projectId = this.config.projectId, viewId = this.config.kanbanViewId) {
    return this.list<EFBucket>(`/projects/${projectId}/views/${viewId}/buckets`);
  }

  /** GET /projects/{id}/views/{view}/tasks */
  getViewTasks(
    params: {
      projectId?: number;
      viewId?: number;
      page?: number;
      perPage?: number;
      s?: string;
      expand?: string;
    } = {}
  ) {
    const {
      projectId = this.config.projectId,
      viewId = this.config.tableViewId,
      page,
      perPage,
      s,
      expand
    } = params;
    return this.list<EFTask>(`/projects/${projectId}/views/${viewId}/tasks`, {
      query: { page, per_page: perPage, s, expand }
    });
  }

  /** PUT /projects/{id}/tasks — body: models.Task */
  createTask(payload: EFCreateTaskPayload, projectId = this.config.projectId) {
    return this.request<EFTask>(`/projects/${projectId}/tasks`, { method: 'PUT', body: payload });
  }

  /** GET /tasks/{id} */
  getTask(taskId: number, expand?: string) {
    return this.request<EFTask>(`/tasks/${taskId}`, { query: { expand } });
  }

  /** POST /tasks/{id} — body: models.Task */
  updateTask(taskId: number, patch: Partial<EFTask>) {
    return this.request<EFTask>(`/tasks/${taskId}`, { method: 'POST', body: patch });
  }

  /** POST /projects/{project}/views/{view}/buckets/{bucket}/tasks — body: models.TaskBucket */
  moveTaskToBucket(
    taskId: number,
    bucketId: number,
    projectId = this.config.projectId,
    viewId = this.config.kanbanViewId
  ) {
    const body: EFTaskBucket = {
      task_id: taskId,
      bucket_id: bucketId,
      project_view_id: viewId
    };
    return this.request<EFTaskBucket>(
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`,
      { method: 'POST', body }
    );
  }

  /** Some endpoints answer 200 with an empty body; never hand back null. */
  private async list<T>(path: string, opts: RequestOptions = {}): Promise<T[]> {
    const data = await this.request<T[] | null>(path, opts);
    return Array.isArray(data) ? data : [];
  }

  /** GET /users?s=... — global search; needs the "Users" token permission. */
  searchUsers(s: string) {
    return this.list<EFUser>(`/users`, { query: { s } });
  }

  /**
   * GET /projects/{id}/projectusers?s=... — searches only people who already
   * have access to the project. Covered by the "Projects: Projectusers"
   * permission, so it works with API tokens that cannot use /users.
   */
  searchProjectUsers(s: string, projectId = this.config.projectId) {
    return this.list<EFUser>(`/projects/${projectId}/projectusers`, { query: { s } });
  }

  /** GET /tasks/{taskID}/assignees */
  getAssignees(taskId: number) {
    return this.list<EFUser>(`/tasks/${taskId}/assignees`);
  }

  /** PUT /tasks/{taskID}/assignees — body: models.TaskAssginee */
  addAssignee(taskId: number, userId: number) {
    const body: EFTaskAssginee = { user_id: userId };
    return this.request<unknown>(`/tasks/${taskId}/assignees`, { method: 'PUT', body });
  }

  /** POST /tasks/{taskID}/assignees/bulk — body: models.BulkAssignees */
  addAssigneesBulk(taskId: number, users: EFUser[]) {
    return this.request<unknown>(`/tasks/${taskId}/assignees/bulk`, {
      method: 'POST',
      body: { assignees: users }
    });
  }
}
