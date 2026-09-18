import type { CreatedTaskResult, MovedTaskResult, ParsedTask } from '../types/edgefocus.js';

/** Shared password, kept only in this browser and sent as a header. */
const PASSWORD_KEY = 'edgefocus.password';

export function getPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPassword(value: string): void {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* ignore — the header still works for this page load */
  }
}

export interface ApiError {
  error: string;
  kind?: string;
  detail?: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-password': getPassword() },
      body: JSON.stringify(body)
    });
  } catch (err) {
    // Real transport failure: offline, DNS, or the request never completed.
    throw {
      error: navigator.onLine
        ? 'Сервер не ответил. Попробуйте ещё раз через несколько секунд.'
        : 'Нет соединения с интернетом.',
      kind: 'network',
      detail: `${url}: ${err instanceof Error ? err.message : String(err)}`
    } as ApiError;
  }

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (data && typeof data === 'object') throw data as ApiError;
    // Vercel returns an HTML error page for timeouts and crashes.
    throw {
      error:
        res.status === 504
          ? 'Запрос к EdgeFocus занял слишком много времени.'
          : `Сервер вернул ошибку ${res.status}.`,
      kind: 'server',
      detail: `${url} -> ${res.status}\n${text.slice(0, 500)}`
    } as ApiError;
  }

  if (data === undefined) {
    throw {
      error: 'Сервер вернул неожиданный ответ.',
      kind: 'server',
      detail: `${url} -> ${res.status}\n${text.slice(0, 500)}`
    } as ApiError;
  }

  return data as T;
}

/** GET with the same error handling as post(). */
async function get<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'x-app-password': getPassword() } });
  } catch (err) {
    throw {
      error: navigator.onLine
        ? 'Сервер не ответил. Попробуйте ещё раз через несколько секунд.'
        : 'Нет соединения с интернетом.',
      kind: 'network',
      detail: `${url}: ${err instanceof Error ? err.message : String(err)}`
    } as ApiError;
  }
  const text = await res.text().catch(() => '');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    if (data && typeof data === 'object') throw data as ApiError;
    throw {
      error:
        res.status === 504
          ? 'Запрос к EdgeFocus занял слишком много времени.'
          : `Сервер вернул ошибку ${res.status}.`,
      kind: 'server',
      detail: `${url} -> ${res.status}\n${text.slice(0, 500)}`
    } as ApiError;
  }
  if (data === undefined) {
    throw { error: 'Сервер вернул неожиданный ответ.', kind: 'server', detail: `${url} -> ${res.status}` } as ApiError;
  }
  return data as T;
}

export interface BoardTask {
  taskId: number;
  title: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  url: string;
}

export interface BoardGroup {
  bucket: string;
  tasks: BoardTask[];
}

export interface DuplicateCandidate {
  taskId: number;
  title: string;
  dueDate: string | null;
  created: string | null;
  url: string;
}

export const api = {
  parse: (input: {
    text?: string;
    title?: string;
    date?: string;
    estimate?: string;
    description?: string;
  }) =>
    post<{ parsed: ParsedTask; targetBucket: string }>('/api/parse', input),
  preflight: (title: string, dueDate: string | null, bucket?: string) =>
    post<{
      bucket: { id: number; title: string };
      autoRouted: boolean;
      buckets: Array<{ id: number; title: string }>;
      duplicates: DuplicateCandidate[];
    }>('/api/preflight', { title, dueDate, bucket }),
  searchTasks: (query: string) =>
    post<{ tasks: Array<{ taskId: number; title: string; done: boolean; url: string }> }>(
      '/api/tasks/search',
      { query }
    ),
  moveTask: (taskId: number, bucket: string) =>
    post<MovedTaskResult>(`/api/tasks/${taskId}/move`, { bucket }),
  create: (parsed: ParsedTask) => post<CreatedTaskResult>('/api/tasks', parsed),
  /** Single round trip: duplicate check + create, unless confirmation is needed. */
  quickCreate: (parsed: ParsedTask, force = false) =>
    post<
      | { needsConfirmation: true; duplicates: DuplicateCandidate[]; bucket: { id: number; title: string }; autoRouted: boolean }
      | { needsConfirmation: false; result: CreatedTaskResult }
    >('/api/tasks/quick', { ...parsed, force }),
  board: async (): Promise<BoardGroup[]> => {
    const data = await get<{ groups?: BoardGroup[] }>('/api/board');
    return Array.isArray(data.groups) ? data.groups : [];
  },
  diag: () => get<{ ok: boolean; totalMs: number; steps: unknown[] }>('/api/diag'),
  health: async (): Promise<{
    ok: boolean;
    passwordRequired: boolean;
    tokenConfigured: boolean;
    doneBucket?: string;
    targetBucket?: string;
    defaultAssignee?: string;
  } | null> => {
    try {
      const res = await fetch('/api/health');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
};
