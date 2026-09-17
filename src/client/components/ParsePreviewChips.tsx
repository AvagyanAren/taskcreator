import type { ParsedTask } from '../../types/edgefocus.js';
import { formatDay, formatEstimate } from '../format.js';

/** Live feedback under the input: what the parser understood, as you type. */
export function ParsePreviewChips({ parsed, bucket }: { parsed: ParsedTask; bucket: string }) {
  if (!parsed.title && !parsed.dueDate && !parsed.estimateMinutes) return null;
  return (
    <div className="chips">
      {parsed.title && <span className="chip title">{parsed.title}</span>}
      <span className={parsed.dueDate ? 'chip' : 'chip muted'}>
        {parsed.dueDate ? formatDay(parsed.dueDate) : 'без даты'}
      </span>
      <span className={parsed.estimateMinutes ? 'chip' : 'chip muted'}>
        {parsed.estimateMinutes ? formatEstimate(parsed.estimateMinutes) : 'без estimate'}
      </span>
      <span className="chip">{bucket}</span>
      {parsed.assignee && <span className="chip">{parsed.assignee}</span>}
      {parsed.description && <span className="chip">описание +</span>}
    </div>
  );
}
