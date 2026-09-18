const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

export function formatDay(day: string | null): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatEstimate(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}ч ${m}м`;
  if (h) return `${h}ч`;
  return `${m}м`;
}

export function formatTimeRange(start?: string | null, end?: string | null): string | null {
  if (start && end) return `${start} – ${end}`;
  if (end) return `до ${end}`;
  if (start) return `с ${start}`;
  return null;
}
