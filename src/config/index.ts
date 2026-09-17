import 'dotenv/config';

export class ConfigError extends Error {}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new ConfigError(
      `${name} is not configured.\n\n` +
        `Create a .env file in the project root (copy .env.example) and add:\n` +
        `  ${name}=<value>\n\n` +
        `Then restart the app.`
    );
  }
  return v.trim();
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) throw new ConfigError(`${name} must be a number, got "${raw}".`);
  return n;
}

export interface AppConfig {
  baseUrl: string;
  projectId: number;
  kanbanViewId: number;
  tableViewId: number;
  targetBucket: string;
  doneBucket: string;
  defaultAssignee: string;
  setStartDate: boolean;
  webUrl: string;
  port: number;
}

export function loadConfig(): AppConfig {
  return {
    baseUrl: (process.env.EDGEFOCUS_BASE_URL || 'https://edgefocus.ru/api/v1').replace(/\/+$/, ''),
    projectId: num('EDGEFOCUS_PROJECT_ID', 176),
    kanbanViewId: num('EDGEFOCUS_KANBAN_VIEW_ID', 765),
    tableViewId: num('EDGEFOCUS_TABLE_VIEW_ID', 764),
    targetBucket: process.env.EDGEFOCUS_TARGET_BUCKET || 'Дизайн',
    doneBucket:
      process.env.EDGEFOCUS_DONE_BUCKET === undefined
        ? 'Выпущено'
        : process.env.EDGEFOCUS_DONE_BUCKET.trim(),
    setStartDate: (process.env.EDGEFOCUS_SET_START_DATE || 'true').trim().toLowerCase() !== 'false',
    defaultAssignee: (process.env.EDGEFOCUS_DEFAULT_ASSIGNEE || '').trim(),
    webUrl: (process.env.EDGEFOCUS_WEB_URL || 'https://edgefocus.ru').replace(/\/+$/, ''),
    port: num('PORT', 3001)
  };
}

/** Never logged, never returned to the frontend. */
export function loadToken(): string {
  return required('EDGEFOCUS_TOKEN');
}

/** Removes the token from any string before it reaches a log or the UI. */
export function redact(text: string, token?: string): string {
  if (!token) return text;
  return text.split(token).join('***REDACTED***');
}
