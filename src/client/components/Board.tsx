import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError, type BoardGroup, type BoardStats } from '../api.js';
import { formatDay, formatEstimate } from '../format.js';

/** Open tasks straight from the Kanban board, with one-click completion. */
export function Board({ doneBucket, reloadKey }: { doneBucket: string; reloadKey: number }) {
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [stats, setStats] = useState<BoardStats | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.board();
      setGroups(data.groups);
      setStats(data.stats ?? null);
    } catch (err) {
      setError((err as ApiError) ?? { error: 'Не удалось загрузить доску.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load, reloadKey]);

  const complete = async (taskId: number) => {
    setMovingId(taskId);
    setError(null);
    try {
      await api.moveTask(taskId, doneBucket);
      await load();
    } catch (err) {
      setError((err as ApiError) ?? { error: 'Не удалось перенести задачу.' });
    } finally {
      setMovingId(null);
    }
  };

  const total = groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="card">
      <button className="disclosure" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Задачи в работе{open && total > 0 ? ` (${total})` : ''}
      </button>

      {open && (
        <div className="board">
          {loading && <p className="hint">Загружаю…</p>}
          {error && (
            <div className="banner error">
              <strong>{error.error}</strong>
              {error.detail && (
                <details>
                  <summary>Technical details</summary>
                  <pre>{error.detail}</pre>
                </details>
              )}
            </div>
          )}
          {!loading && !error && groups.length === 0 && (
            <>
              <p className="hint">Открытых задач нет.</p>
              {stats && (
                <p className="hint">
                  EdgeFocus вернул задач: {stats.received}, из них открытых: {stats.open},
                  с определённой колонкой: {stats.resolved}.
                </p>
              )}
            </>
          )}

          {groups.map((group) => (
            <section key={group.bucket}>
              <h3>
                {group.bucket} <span className="count">{group.tasks.length}</span>
              </h3>
              <ul>
                {group.tasks.map((task) => (
                  <li key={task.taskId}>
                    <div className="task">
                      <a href={task.url} target="_blank" rel="noreferrer">
                        {task.title}
                      </a>
                      <span className="meta">
                        {formatDay(task.dueDate ? task.dueDate.slice(0, 10) : null)}
                        {task.estimateMinutes ? ` · ${formatEstimate(task.estimateMinutes)}` : ''}
                      </span>
                    </div>
                    {group.bucket !== doneBucket && (
                      <button
                        className="ghost small"
                        disabled={movingId === task.taskId}
                        onClick={() => complete(task.taskId)}
                      >
                        {movingId === task.taskId ? '…' : `→ ${doneBucket}`}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
