/**
 * Whatever the person typed survives reloads, password prompts and crashes.
 * Losing a half-written task to a 401 is the most annoying failure there is.
 */
const KEY = 'edgefocus.draft.v1';

export interface Draft {
  text: string;
  title: string;
  date: string;
  estimate: string;
  description: string;
  mode: 'nl' | 'fields';
}

export const EMPTY_DRAFT: Draft = {
  text: '',
  title: '',
  date: '',
  estimate: '',
  description: '',
  mode: 'nl'
};

export function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw);
    return { ...EMPTY_DRAFT, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: Partial<Draft>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readDraft(), ...draft }));
  } catch {
    /* private mode or quota — the form still works in memory */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
