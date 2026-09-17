import type { ParsedTask } from '../../types/edgefocus.js';
import type { DuplicateCandidate } from '../api.js';
import { formatDay, formatEstimate } from '../format.js';

interface Props {
  parsed: ParsedTask;
  bucket: string;
  buckets: Array<{ id: number; title: string }>;
  onBucketChange: (title: string) => void;
  autoRouted: boolean;
  onAssigneeClear: () => void;
  duplicates: DuplicateCandidate[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TaskPreview({
  parsed,
  bucket,
  buckets,
  onBucketChange,
  autoRouted,
  onAssigneeClear,
  duplicates,
  busy,
  onConfirm,
  onCancel
}: Props) {
  return (
    <div className="card preview">
      <h2>Проверьте данные</h2>
      <dl>
        <dt>Task</dt>
        <dd>{parsed.title || <span className="warn">не распознано</span>}</dd>
        {parsed.description && (
          <>
            <dt>Description</dt>
            <dd className="desc">{parsed.description}</dd>
          </>
        )}
        <dt>Date</dt>
        <dd>{formatDay(parsed.dueDate)}</dd>
        <dt>Estimate</dt>
        <dd>{formatEstimate(parsed.estimateMinutes)}</dd>
        <dt>Колонка</dt>
        <dd>
          {buckets.length > 1 ? (
            <select
              className="inline-select"
              value={bucket}
              disabled={busy}
              onChange={(e) => onBucketChange(e.target.value)}
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.title}>
                  {b.title}
                </option>
              ))}
            </select>
          ) : (
            bucket
          )}
          {autoRouted && (
            <div className="auto-note">
              Дата уже прошла — задача отправляется в «{bucket}» как завершённая.
              Колонку можно изменить.
            </div>
          )}
        </dd>
        {parsed.assignee && (
          <>
            <dt>Assignee</dt>
            <dd>
              {parsed.assignee}
              <button className="linkish" onClick={onAssigneeClear} disabled={busy}>
                убрать
              </button>
            </dd>
          </>
        )}
      </dl>

      {duplicates.length > 0 && (
        <div className="banner warning">
          <strong>Возможно, такая задача уже была создана.</strong>
          <ul>
            {duplicates.map((d) => (
              <li key={d.taskId}>
                <a href={d.url} target="_blank" rel="noreferrer">
                  #{d.taskId} {d.title}
                </a>{' '}
                — {formatDay(d.dueDate)}
              </li>
            ))}
          </ul>
          <span>Дубликат не создаётся автоматически — подтвердите, если задача всё-таки нужна.</span>
        </div>
      )}

      <div className="row">
        <button className="primary" onClick={onConfirm} disabled={busy || !parsed.title}>
          {busy ? 'Создаю…' : 'Создать'}
        </button>
        <button className="ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}
