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
  } catch {
    throw { error: 'Не удалось связаться с локальным сервером. Он запущен?' } as ApiError;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data as ApiError;
  return data as T;
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
  health: async (): Promise<{
    ok: boolean;
    passwordRequired: boolean;
    tokenConfigured: boolean;
    doneBucket?: string;
  } | null> => {
    try {
      const res = await fetch('/api/health');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
};
