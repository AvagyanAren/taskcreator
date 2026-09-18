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
 * How far back a bare "10 сентября" is still read as this year's date rather
 * than next year's. Recent past dates are normal here — a task finished
 * yesterday goes straight to the done column.
 */
const PAST_TOLERANCE_DAYS = 90;

/**
 * Builds a date from day/month with an optional year.
 * When the year is omitted we use the current year; a day that passed more
 * than PAST_TOLERANCE_DAYS ago is read as next year instead.
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
    const daysAgo = (startOfDay(now).getTime() - candidate.getTime()) / 86400000;
    if (daysAgo > PAST_TOLERANCE_DAYS) {
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


/* ------------------------------------------------------------------ */
/* Time of day                                                         */
/* ------------------------------------------------------------------ */

function normalizeTime(hours: string, minutes: string | undefined): string | null {
  const h = Number(hours);
  const m = minutes === undefined ? 0 : Number(minutes);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** "с 10:00 до 18:00", "10:00-18:00", "10:00 — 18:30". */
export function findTimeRange(text: string): Match<{ start: string; end: string }> | null {
  const re = new RegExp(
    `${BS}(?:с|from)?\\s*(\\d{1,2}):(\\d{2})\\s*(?:до|по|-|–|—|to|until)\\s*(\\d{1,2}):(\\d{2})${BE}`,
    'iu'
  );
  const m = re.exec(text);
  if (!m) return null;
  const start = normalizeTime(m[1], m[2]);
  const end = normalizeTime(m[3], m[4]);
  if (!start || !end) return null;
  const lead = m[0].length - m[0].trimStart().length;
  return {
    value: { start, end },
    start: m.index + lead,
    end: m.index + m[0].length,
    raw: m[0].trim()
  };
}

/** A single "в 14:00" / "at 14:30" / bare "14:00". */
export function findSingleTime(text: string): Match<string> | null {
  const re = new RegExp(`${BS}(?:в|at|к)?\\s*(\\d{1,2}):(\\d{2})${BE}`, 'iu');
  const m = re.exec(text);
  if (!m) return null;
  const value = normalizeTime(m[1], m[2]);
  if (!value) return null;
  const lead = m[0].length - m[0].trimStart().length;
  return { value, start: m.index + lead, end: m.index + m[0].length, raw: m[0].trim() };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/** "50%", "прогресс 50%", "готово на 30%", "progress 75%". */
export function findProgress(text: string): Match<number> | null {
  const re = new RegExp(
    `${BS}(?:прогресс|выполнено|готово(?:\\s+на)?|сделано(?:\\s+на)?|progress|done)?\\s*(\\d{1,3})\\s*%`,
    'iu'
  );
  const m = re.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const lead = m[0].length - m[0].trimStart().length;
  return { value, start: m.index + lead, end: m.index + m[0].length, raw: m[0].trim() };
}

/* ------------------------------------------------------------------ */
/* Date range                                                          */
/* ------------------------------------------------------------------ */

/**
 * "с 18.09 по 20.09" / "с 18 сентября до 20 сентября".
 * Returns both days; the caller removes the whole fragment from the title.
 */
export function findDateRange(
  text: string,
  now: Date = new Date()
): Match<{ start: string; end: string }> | null {
  const opener = new RegExp(`${BS}(?:с|from)${BE}\\s*`, 'iu').exec(text);
  if (!opener) return null;

  const afterOpener = opener.index + opener[0].length;
  const first = findDate(text.slice(afterOpener), now);
  if (!first || first.start > 2) return null;

  const restIndex = afterOpener + first.end;
  const rest = text.slice(restIndex);
  const separator = new RegExp(`^\\s*(?:по|до|-|–|—|to|until)\\s*`, 'iu').exec(rest);
  if (!separator) return null;

  const second = findDate(rest.slice(separator[0].length), now);
  if (!second || second.start > 2) return null;

  return {
    value: { start: first.value, end: second.value },
    start: opener.index,
    end: restIndex + separator[0].length + second.end,
    raw: text.slice(opener.index, restIndex + separator[0].length + second.end).trim()
  };
}


/* ------------------------------------------------------------------ */
/* Editing an existing task                                            */
/* ------------------------------------------------------------------ */

export interface EditCommand {
  /** The number printed on the card, e.g. "249". */
  number: string;
  patch: ParsedTask;
}

/**
 * Recognises "#249 прогресс 60%", "#249 на пятницу, 2h", "249: 80%".
 *
 * The number must be marked as a reference — either "#249" or "249:". A bare
 * leading number is part of a normal title ("2 задачи по адаптиву, завтра"),
 * and editing a random task instead of creating one would be a bad surprise.
 */
export function parseEditCommand(input: string, now: Date = new Date()): EditCommand | null {
  const text = (input ?? '').trim();
  const head = /^(?:#(\d{1,7})|(\d{1,7})\s*[:—–-])\s*(.+)$/s.exec(text);
  if (!head) return null;

  const number = head[1] ?? head[2];
  const rest = (head[3] ?? '').trim();
  if (!rest) return null;

  const patch = parseTaskInput(rest, now);
  const touchesSomething =
    patch.dueDate !== null ||
    patch.estimateMinutes !== null ||
    patch.percentDone !== null ||
    patch.priority !== null ||
    (patch.labels?.length ?? 0) > 0 ||
    patch.startTime !== null ||
    patch.endTime !== null;

  // Without a recognised field this is just a task whose title starts with a
  // number — creating it is the right call, not editing something.
  if (!touchesSomething) return null;

  return { number, patch };
}

/* ------------------------------------------------------------------ */
/* Labels and priority                                                 */
/* ------------------------------------------------------------------ */

/** "#багфикс", "#mobile". Must not swallow a task number like "#249". */
export function extractLabels(text: string): { labels: string[]; rest: string } {
  const re = new RegExp(`(?:^|\\s)#([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_-]*)`, 'gu');
  const labels: string[] = [];
  const rest = text.replace(re, (whole, name: string) => {
    labels.push(name);
    return whole.startsWith('#') ? '' : ' ';
  });
  return { labels, rest };
}

const PRIORITY_WORDS: Record<string, number> = {
  низкий: 1, low: 1,
  средний: 2, medium: 2, normal: 2,
  высокий: 3, high: 3, важно: 3, important: 3,
  срочно: 4, urgent: 4,
  критично: 5, critical: 5, critically: 5
};

/** "!важно", "!3", "!urgent". Returns 0–5 per models.Task.priority. */
export function findPriority(text: string): Match<number> | null {
  const re = new RegExp(
    `(?:^|\\s)!(\\d|низкий|средний|высокий|важно|срочно|критично|low|medium|normal|high|important|urgent|critical)${BE}`,
    'iu'
  );
  const m = re.exec(text);
  if (!m) return null;
  const token = m[1].toLowerCase();
  const value = /^\d$/.test(token) ? Number(token) : PRIORITY_WORDS[token];
  if (value === undefined || value < 0 || value > 5) return null;
  const offset = m[0].indexOf('!');
  return { value, start: m.index + offset, end: m.index + m[0].length, raw: m[0].trim() };
}

/* ------------------------------------------------------------------ */
/* Several tasks at once                                               */
/* ------------------------------------------------------------------ */

/**
 * Splits a batch input into separate task blocks. Only an explicit "---" line
 * separates them: blank lines already mean paragraphs inside a description.
 */
export function splitTasks(input: string): string[] {
  return (input ?? '')
    .replace(/\r\n/g, '\n')
    .split(/^\s*-{3,}\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);
}

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

  const { labels, rest: withoutLabels } = extractLabels(rest);
  rest = withoutLabels;

  const priority = findPriority(rest);
  if (priority) rest = cutSegment(rest, priority.start, priority.end);

  const assignee = findAssignee(rest);
  if (assignee) rest = cutSegment(rest, assignee.start, assignee.end);

  // "%" is unambiguous, so progress is taken out before any number parsing.
  const progress = findProgress(rest);
  if (progress) rest = cutSegment(rest, progress.start, progress.end);

  // Times carry a colon, which nothing else in the syntax uses.
  const timeRange = findTimeRange(rest);
  if (timeRange) rest = cutSegment(rest, timeRange.start, timeRange.end);

  const estimate = findEstimate(rest);
  if (estimate) rest = cutSegment(rest, estimate.start, estimate.end);

  const range = findDateRange(rest, now);
  if (range) rest = cutSegment(rest, range.start, range.end);

  const date = range ? null : findDate(rest, now);
  if (date) rest = cutSegment(rest, date.start, date.end);

  const singleTime = timeRange ? null : findSingleTime(rest);
  if (singleTime) rest = cutSegment(rest, singleTime.start, singleTime.end);

  // "Созвон с 10:00 до 18:00" without a day means today — otherwise the time
  // would be parsed and then silently dropped for lack of a date.
  const explicitDay = range ? range.value.end : date ? date.value : null;
  const hasTime = Boolean(timeRange || singleTime);
  const dueDate = explicitDay ?? (hasTime ? isoOf(startOfDay(now)) : null);

  return {
    title: cleanTitle(rest),
    dueDate,
    startDate: range ? range.value.start : null,
    startTime: timeRange ? timeRange.value.start : null,
    endTime: timeRange ? timeRange.value.end : singleTime ? singleTime.value : null,
    percentDone: progress ? progress.value : null,
    estimateMinutes: estimate ? estimate.value : null,
    assignee: assignee ? assignee.value : null,
    labels,
    priority: priority ? priority.value : null,
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

/**
 * Combines a calendar day with a local wall-clock time into RFC3339 UTC.
 * `tzOffsetMinutes` is what `Date.prototype.getTimezoneOffset()` returns in the
 * person's browser (UTC+4 → -240), so the time they typed is the time they see.
 */
export function dayTimeToRFC3339(
  day: string,
  time: string | null | undefined,
  tzOffsetMinutes = 0,
  fallbackHourUtc = 12
): string {
  if (!time) return isoDayToRFC3339(day, fallbackHourUtc);
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (!y || !mo || !d || !Number.isFinite(h) || !Number.isFinite(mi)) {
    return isoDayToRFC3339(day, fallbackHourUtc);
  }
  const utcMs = Date.UTC(y, mo - 1, d, h, mi) + tzOffsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

/** Local wall-clock "HH:MM" of an RFC3339 timestamp, for verification. */
export function rfc3339ToLocalTime(
  value: string | undefined | null,
  tzOffsetMinutes = 0
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return null;
  const local = new Date(date.getTime() - tzOffsetMinutes * 60_000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
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
