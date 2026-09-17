import type { ParsedTask } from '../types/edgefocus.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const RU_MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12
};

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, среду: 3,
  четверг: 4, пятница: 5, пятницу: 5, суббота: 6, субботу: 6
};

const MONTH_RU_RE =
  '(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|мая|май|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])';
const MONTH_EN_RE =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
const WEEKDAY_RE =
  '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)';


/**
 * JavaScript's `\b` only understands ASCII word characters, so it breaks on
 * Cyrillic. These Unicode-aware lookarounds replace it everywhere.
 */
const BS = '(?<![\\p{L}\\p{N}_])';
const BE = '(?![\\p{L}\\p{N}_])';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isoOf(date: Date): string {
  return toISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeYear(year: number): number {
  if (year >= 1000) return year;
  return 2000 + year;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Builds a date from day/month with an optional year.
 * When the year is omitted we use the current year and roll forward
 * to the next one if that day has already passed.
 */
function resolveDayMonth(
  day: number,
  month: number,
  year: number | undefined,
  now: Date
): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  let y = year !== undefined ? normalizeYear(year) : now.getFullYear();
  if (day > daysInMonth(y, month)) return null;
  if (year === undefined) {
    const candidate = new Date(y, month - 1, day);
    if (candidate.getTime() < startOfDay(now).getTime()) {
      y += 1;
      if (day > daysInMonth(y, month)) return null;
    }
  }
  return toISO(y, month, day);
}

function ruMonthNumber(word: string): number | undefined {
  const w = word.toLowerCase();
  for (const stem of Object.keys(RU_MONTHS)) {
    if (w.startsWith(stem)) return RU_MONTHS[stem];
  }
  return undefined;
}

function enMonthNumber(word: string): number | undefined {
  return EN_MONTHS[word.toLowerCase().slice(0, 3)];
}

/* ------------------------------------------------------------------ */
/* Date parsing                                                        */
/* ------------------------------------------------------------------ */

export interface Match<T> {
  value: T;
  /** Index range inside the source string that produced the value. */
  start: number;
  end: number;
  raw: string;
}

/** Ordered: the more specific patterns come first. */
function dateMatchers(now: Date): Array<{ re: RegExp; build: (m: RegExpExecArray) => string | null }> {
  return [
    // 2026-09-25
    {
      re: new RegExp(`${BS}(\\d{4})-(\\d{1,2})-(\\d{1,2})${BE}`, 'gu'),
      build: (m) => {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
        return toISO(y, mo, d);
      }
    },
    // 25 сентября [2026] / сентября 25
    {
      re: new RegExp(`${BS}(\\d{1,2})\\s+${MONTH_RU_RE}(?:\\s+(\\d{4}))?(?:\\s*г\\.?)?${BE}`, 'giu'),
      build: (m) => {
        const mo = ruMonthNumber(m[2]);
        if (!mo) return null;
        return resolveDayMonth(Number(m[1]), mo, m[3] ? Number(m[3]) : undefined, now);
      }
    },
    // 25 September [2026]
    {
      re: new RegExp(`${BS}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_EN_RE}${BE}(?:\\s+(\\d{4}))?`, 'giu'),
      build: (m) => {
        const mo = enMonthNumber(m[2]);
        if (!mo) return null;
        return resolveDayMonth(Number(m[1]), mo, m[3] ? Number(m[3]) : undefined, now);
      }
    },
    // September 25[, 2026]
    {
      re: new RegExp(`${BS}${MONTH_EN_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?${BE}(?:,?\\s+(\\d{4}))?`, 'giu'),
      build: (m) => {
        const mo = enMonthNumber(m[1]);
        if (!mo) return null;
        return resolveDayMonth(Number(m[2]), mo, m[3] ? Number(m[3]) : undefined, now);
      }
    },
    // 20.09 / 20.09.2026 / 20/09/26
    {
      re: new RegExp(`${BS}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${BE}`, 'gu'),
      build: (m) =>
        resolveDayMonth(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined, now)
    },
    // послезавтра / day after tomorrow
    {
      re: new RegExp(`${BS}(послезавтра|day after tomorrow)${BE}`, 'giu'),
      build: () => isoOf(addDays(now, 2))
    },
    // завтра / tomorrow
    {
      re: new RegExp(`${BS}(завтра|tomorrow)${BE}`, 'giu'),
      build: () => isoOf(addDays(now, 1))
    },
    // сегодня / today
    {
      re: new RegExp(`${BS}(сегодня|today)${BE}`, 'giu'),
      build: () => isoOf(startOfDay(now))
    },
    // next Monday / следующий понедельник / в понедельник
    {
      re: new RegExp(
        `${BS}(?:next|следующ(?:ий|ая|ую|ее)|в|во|on)?\\s*${WEEKDAY_RE}${BE}`,
        'giu'
      ),
      build: (m) => {
        const target = WEEKDAYS[m[1].toLowerCase()];
        if (target === undefined) return null;
        const base = startOfDay(now);
        let delta = (target - base.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // "next monday" is never today
        return isoOf(addDays(base, delta));
      }
    }
  ];
}

export function findDate(text: string, now: Date = new Date()): Match<string> | null {
  for (const { re, build } of dateMatchers(now)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!m[0].trim()) {
        re.lastIndex += 1;
        continue;
      }
      const value = build(m);
      if (value) {
        // Trim leading whitespace captured by optional prefixes.
        const lead = m[0].length - m[0].trimStart().length;
        return {
          value,
          start: m.index + lead,
          end: m.index + m[0].length,
          raw: m[0].trim()
        };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Estimate parsing                                                    */
/* ------------------------------------------------------------------ */

const HOURS_UNIT = '(?:h|hr|hrs|hour|hours|ч|час|часа|часов|часам)';
const MINUTES_UNIT = '(?:m|min|mins|minute|minutes|м|мин|минут|минуты|минута)';
const NUM = '(\\d+(?:[.,]\\d+)?)';

const COMBO_RE = new RegExp(`${BS}${NUM}\\s*${HOURS_UNIT}\\s*${NUM}\\s*${MINUTES_UNIT}?${BE}`, 'iu');
const HOURS_RE = new RegExp(`${BS}${NUM}\\s*${HOURS_UNIT}${BE}`, 'iu');
const MINUTES_RE = new RegExp(`${BS}${NUM}\\s*${MINUTES_UNIT}${BE}`, 'iu');

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

export function findEstimate(text: string): Match<number> | null {
  const combo = COMBO_RE.exec(text);
  if (combo) {
    const minutes = Math.round(toNumber(combo[1]) * 60 + toNumber(combo[2]));
    if (minutes > 0) {
      return { value: minutes, start: combo.index, end: combo.index + combo[0].length, raw: combo[0] };
    }
  }
  const hours = HOURS_RE.exec(text);
  if (hours) {
    const minutes = Math.round(toNumber(hours[1]) * 60);
    if (minutes > 0) {
      return { value: minutes, start: hours.index, end: hours.index + hours[0].length, raw: hours[0] };
    }
  }
  const mins = MINUTES_RE.exec(text);
  if (mins) {
    const minutes = Math.round(toNumber(mins[1]));
    if (minutes > 0) {
      return { value: minutes, start: mins.index, end: mins.index + mins[0].length, raw: mins[0] };
    }
  }
  return null;
}

/** Parses a standalone estimate string such as "2h", "1h 30m", "90m", "2.5h". */
export function parseEstimate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const found = findEstimate(trimmed);
  if (found) return found.value;
  if (/^\d+$/.test(trimmed)) return Number(trimmed); // bare number = minutes
  return null;
}

export function formatEstimate(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/* ------------------------------------------------------------------ */
/* Assignee parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Matches "assign Aren", "исполнитель Арен Авагян", "@aren".
 * Captures up to three capitalised/plain words so full names survive.
 */
const ASSIGNEE_KEYWORD_RE = new RegExp(
  `${BS}(?:assign(?:ee|ed)?(?:\\s+to)?|исполнитель|назначить(?:\\s+на)?|на\\s+кого)\\s*:?\\s*` +
    `@?([A-Za-zА-Яа-яЁё0-9._-]{2,}(?:\\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.-]{1,}){0,2})`,
  'iu'
);
const ASSIGNEE_AT_RE = /(?:^|[\s,(-])@([A-Za-z0-9._-]{2,})/;

export function findAssignee(text: string): Match<string> | null {
  const kw = ASSIGNEE_KEYWORD_RE.exec(text);
  if (kw) {
    return { value: kw[1], start: kw.index, end: kw.index + kw[0].length, raw: kw[0] };
  }
  const at = ASSIGNEE_AT_RE.exec(text);
  if (at) {
    const offset = at[0].indexOf('@');
    return {
      value: at[1],
      start: at.index + offset,
      end: at.index + at[0].length,
      raw: at[0].slice(offset)
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Title cleanup                                                       */
/* ------------------------------------------------------------------ */

/** Prepositions that introduce a date/estimate and should die with it. */
const LEADING_NOISE_RE = new RegExp(
  `(?:${BS}(?:до|к|на|за|by|due(?:\\s+date)?|deadline|дедлайн|срок|estimate|оценка|примерно|около|in)${BE}\\s*:?\\s*)$`,
  'iu'
);

function cutSegment(text: string, start: number, end: number): string {
  let head = text.slice(0, start);
  const tail = text.slice(end);
  // drop a preposition that immediately preceded the removed fragment
  let prev = head;
  do {
    prev = head;
    head = head.replace(LEADING_NOISE_RE, '');
  } while (head !== prev);
  return head + tail;
}

export function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\s,;]*[-–—]\s*$/g, '')
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:.–—-]+$/, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Splits the raw input into "the task line" and "the description".
 * Two ways to write one:
 *   1. anything after the first line break;
 *   2. an explicit keyword — "описание:", "описание -", "description:", "desc:".
 */
export function splitDescription(input: string): { head: string; description: string | null } {
  const text = (input ?? '').replace(/\r\n/g, '\n');

  const keyword = /(?:^|\n|[,;]|\s[-–—]\s)\s*(?:описание|описанием|подробности|детали|description|desc|body|note|notes)\s*[:\-–—]\s*/iu.exec(
    text
  );
  if (keyword) {
    const head = text.slice(0, keyword.index);
    const description = text.slice(keyword.index + keyword[0].length).trim();
    if (description) return { head, description };
  }

  const nl = text.indexOf('\n');
  if (nl !== -1) {
    const description = text.slice(nl + 1).trim();
    if (description) return { head: text.slice(0, nl), description };
  }

  return { head: text, description: null };
}

export function parseTaskInput(input: string, now: Date = new Date()): ParsedTask {
  const { head, description } = splitDescription(input);
  let rest = head.replace(/\s+/g, ' ').trim();

  const assignee = findAssignee(rest);
  if (assignee) rest = cutSegment(rest, assignee.start, assignee.end);

  const estimate = findEstimate(rest);
  if (estimate) rest = cutSegment(rest, estimate.start, estimate.end);

  const date = findDate(rest, now);
  if (date) rest = cutSegment(rest, date.start, date.end);

  return {
    title: cleanTitle(rest),
    dueDate: date ? date.value : null,
    estimateMinutes: estimate ? estimate.value : null,
    assignee: assignee ? assignee.value : null,
    bucket: null,
    description
  };
}

/* ------------------------------------------------------------------ */
/* Date helpers shared with the service layer                          */
/* ------------------------------------------------------------------ */

/** Parses the structured-mode date field: ISO, 25.09.2026, or natural text. */
export function parseDateInput(input: string, now: Date = new Date()): string | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  const found = findDate(trimmed, now);
  return found ? found.value : null;
}

/**
 * EdgeFocus stores RFC3339 timestamps. We anchor the calendar day at 12:00 UTC
 * so the date never shifts across common timezones on the way back.
 */
export function isoDayToRFC3339(day: string, hourUtc = 12): string {
  return `${day}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;
}

/** Extracts the calendar day from an RFC3339 timestamp returned by the API. */
export function rfc3339ToIsoDay(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1900) return null; // Vikunja's "zero" date
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const DISPLAY_MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

export function formatDay(day: string | null): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${DISPLAY_MONTHS_RU[m - 1]} ${y}`;
}

/* ------------------------------------------------------------------ */
/* Description formatting                                              */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** EdgeFocus stores descriptions as HTML, so plain text becomes paragraphs. */
export function descriptionToHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '';
  return blocks
    .map((b) => `<p>${escapeHtml(b).split('\n').join('<br>')}</p>`)
    .join('');
}

/** Strips tags so a stored description can be compared with what we sent. */
export function htmlToPlain(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
