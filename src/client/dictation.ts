/**
 * Russian speech recognition transliterates English terms: "Overview" comes
 * back as "овервью", "Sign in" as "сайн ин". This maps the terms we actually
 * use back to their proper spelling, so a mixed sentence stays mixed.
 *
 * Only whole words are replaced, and only terms listed here — nothing is
 * guessed, so ordinary Russian words are never mangled.
 */
export interface TermEntry {
  /** Correct spelling that ends up in the task. */
  term: string;
  /** How the recogniser tends to hear it. */
  heard: string[];
}

export const DEFAULT_TERMS: TermEntry[] = [
  { term: 'Overview', heard: ['овервью', 'овервью', 'овервию', 'овервьюв', 'оверв'] },
  { term: 'Profile', heard: ['профайл', 'профайла', 'профиль раздел'] },
  { term: 'Business', heard: ['бизнес раздел', 'бизнесс'] },
  { term: 'Sign in', heard: ['сайн ин', 'сайнин', 'сайн-ин'] },
  { term: 'Sign up', heard: ['сайн ап', 'сайнап', 'сайн-ап'] },
  { term: 'PWA', heard: ['пи ви эй', 'пива', 'пвэ', 'пиви эй', 'пи-ви-эй'] },
  { term: 'API', heard: ['эй пи ай', 'апи', 'эйпиай', 'а пи ай'] },
  { term: 'UI', heard: ['юай', 'ю ай'] },
  { term: 'UX', heard: ['юикс', 'ю икс'] },
  { term: 'Kanban', heard: ['канбан'] },
  { term: 'EdgeFocus', heard: ['эдж фокус', 'эджфокус', 'едж фокус'] },
  { term: 'frontend', heard: ['фронтенд', 'фронт энд', 'фронтэнд'] },
  { term: 'backend', heard: ['бэкенд', 'бекенд', 'бэк энд'] },
  { term: 'deploy', heard: ['деплой'] },
  { term: 'mobile', heard: ['мобайл'] },
  { term: 'desktop', heard: ['десктоп'] },
  { term: 'dashboard', heard: ['дашборд', 'дэшборд'] },
  { term: 'landing', heard: ['лендинг', 'лэндинг'] },
  { term: 'checkout', heard: ['чекаут', 'чек аут'] },
  { term: 'dropdown', heard: ['дропдаун', 'дроп даун'] },
  { term: 'select', heard: ['селект'] },
  { term: 'header', heard: ['хедер', 'хэдер'] },
  { term: 'footer', heard: ['футер'] },
  { term: 'sidebar', heard: ['сайдбар'] },
  { term: 'popup', heard: ['попап', 'поп ап'] },
  { term: 'modal', heard: ['модалка', 'модал'] },
  { term: 'endpoint', heard: ['эндпоинт', 'энд поинт'] },
  { term: 'feature', heard: ['фича', 'фичу'] },
  { term: 'release', heard: ['релиз'] },
  { term: 'sprint', heard: ['спринт'] },
  { term: 'review', heard: ['ревью'] },
  { term: 'merge', heard: ['мердж', 'мерж'] },
  { term: 'commit', heard: ['коммит'] },
  { term: 'push', heard: ['пуш'] },
  { term: 'pull request', heard: ['пул реквест', 'пулреквест'] },
  { term: 'onboarding', heard: ['онбординг'] },
  { term: 'Vercel', heard: ['версель', 'верцель', 'версел'] },
  { term: 'GitHub', heard: ['гитхаб', 'гит хаб'] }
];

const CUSTOM_KEY = 'edgefocus.terms.v1';

/** Terms the person added themselves, stored per browser. */
export function readCustomTerms(): TermEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is TermEntry => Boolean(e?.term) && Array.isArray(e?.heard)
    );
  } catch {
    return [];
  }
}

export function saveCustomTerms(entries: TermEntry[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable — the defaults still apply */
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces heard variants with the proper term. Longer variants are applied
 * first so "сайн ап" wins over a shorter overlapping entry.
 */
export function applyTermDictionary(text: string, terms: TermEntry[] = DEFAULT_TERMS): string {
  if (!text.trim()) return text;

  const pairs = terms
    .flatMap((entry) => entry.heard.map((heard) => ({ heard: heard.trim(), term: entry.term })))
    .filter((pair) => pair.heard.length > 1)
    .sort((a, b) => b.heard.length - a.heard.length);

  let result = text;
  for (const { heard, term } of pairs) {
    // Unicode-aware word boundaries: \b does not work with Cyrillic.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(heard).replace(/\\s+/g, '\\\\s+')}(?![\\p{L}\\p{N}_])`,
      'giu'
    );
    result = result.replace(pattern, term);
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Full post-processing of a dictated phrase. */
export function normalizeDictation(text: string): string {
  return applyTermDictionary(text, [...DEFAULT_TERMS, ...readCustomTerms()]);
}
