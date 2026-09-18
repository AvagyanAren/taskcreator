import type { CreatedTaskResult } from '../../types/edgefocus.js';
import { formatDay, formatEstimate, formatTimeRange } from '../format.js';

export function TaskResult({ result, onReset }: { result: CreatedTaskResult; onReset: () => void }) {
  return (
    <div className={result.verified ? 'card success' : 'card partial'}>
      <h2>{result.verified ? '✓ Task created' : '⚠ Задача создана, но проверка прошла не полностью'}</h2>
      <dl>
        <dt>Title</dt>
        <dd>{result.title}</dd>
        <dt>Date</dt>
        <dd>{formatDay(result.dueDate)}</dd>
        {formatTimeRange(result.startTime, result.endTime) && (
          <>
            <dt>Время</dt>
            <dd>{formatTimeRange(result.startTime, result.endTime)}</dd>
          </>
        )}
        <dt>Estimate</dt>
        <dd>{formatEstimate(result.estimateMinutes)}</dd>
        {result.percentDone !== null && result.percentDone !== undefined && (
          <>
            <dt>Прогресс</dt>
            <dd>{result.percentDone}%</dd>
          </>
        )}
        <dt>Bucket</dt>
        <dd>{result.bucket ?? '—'}</dd>
        {result.assignees.length > 0 && (
          <>
            <dt>Assignees</dt>
            <dd>{result.assignees.join(', ')}</dd>
          </>
        )}
        <dt>Task ID</dt>
        <dd>#{result.taskId}</dd>
      </dl>
      <a className="link" href={result.url} target="_blank" rel="noreferrer">
        Open in EdgeFocus →
      </a>

      <details>
        <summary>Verification</summary>
        <table>
          <tbody>
            {result.verification.map((c) => (
              <tr key={c.field} className={c.ok ? 'ok' : 'fail'}>
                <td>{c.ok ? '✓' : '✗'}</td>
                <td>{c.field}</td>
                <td>{c.expected}</td>
                <td>{c.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <button className="ghost" onClick={onReset}>
        Создать ещё одну
      </button>
    </div>
  );
}
