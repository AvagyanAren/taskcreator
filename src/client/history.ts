import type { CreatedTaskResult, HistoryEntry } from '../types/edgefocus.js';

/**
 * History lives in the browser: Vercel's filesystem is read-only, and this
 * data is per-person anyway. Every access is guarded — storage can be
 * unavailable or throw in private windows.
 */
const KEY = 'edgefocus.history.v1';
const MAX = 50;

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendHistory(result: CreatedTaskResult): HistoryEntry[] {
  const entry: HistoryEntry = { ...result, createdAt: new Date().toISOString() };
  const next = [entry, ...readHistory().filter((e) => e.taskId !== entry.taskId)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode — the list still works for this session */
  }
  return next;
}
