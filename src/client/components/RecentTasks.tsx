import type { HistoryEntry } from '../../types/edgefocus.js';
import { formatDay, formatEstimate } from '../format.js';

export function RecentTasks({ items }: { items: HistoryEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card recent">
      <h2>Recent tasks</h2>
      <ul>
        {items.slice(0, 10).map((t) => (
          <li key={t.taskId}>
            <a href={t.url} target="_blank" rel="noreferrer">
              {t.title}
            </a>
            <span className="meta">
              {formatDay(t.dueDate)} · {formatEstimate(t.estimateMinutes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
