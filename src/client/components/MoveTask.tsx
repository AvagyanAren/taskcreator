import { useState } from 'react';
import { api, type ApiError } from '../api.js';
import type { MovedTaskResult } from '../../types/edgefocus.js';

interface Found {
  taskId: number;
  title: string;
  done: boolean;
  url: string;
}

export function MoveTask({ buckets, doneBucket }: { buckets: string[]; doneBucket: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [bucket, setBucket] = useState(doneBucket);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MovedTaskResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.searchTasks(query);
      setFound(r.tasks);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const move = async (taskId: number) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.moveTask(taskId, bucket));
      setFound(null);
      setQuery('');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <button className="disclosure" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Переместить существующую задачу
      </button>

      {open && (
        <div className="move-body">
          <p className="hint">
            Переносит задачу в выбранную колонку независимо от её дат. По умолчанию — «{doneBucket}
            ».
          </p>

          <label htmlFor="q">Номер или название задачи</label>
          <input
            id="q"
            value={query}
            placeholder="#153 или «Плейбук Ansible»"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                e.preventDefault();
                void search();
              }
            }}
          />

          <label htmlFor="mb">Колонка</label>
          <select id="mb" value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {buckets.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <button className="ghost" onClick={search} disabled={busy || !query.trim()}>
            Найти
          </button>

          {error && <div className="banner error">{error.error}</div>}

          {found && found.length === 0 && <p className="hint">Ничего не найдено.</p>}

          {found && found.length > 0 && (
            <ul className="found">
              {found.map((t) => (
                <li key={t.taskId}>
                  <span>
                    #{t.taskId} {t.title}
                    {t.done && <span className="badge">Done</span>}
                  </span>
                  <button className="ghost small" onClick={() => move(t.taskId)} disabled={busy}>
                    → {bucket}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {result && (
            <div className={result.verified ? 'banner ok' : 'banner warning'}>
              <strong>
                {result.verified ? '✓' : '⚠'} #{result.taskId} {result.title} → {result.bucket}
                {result.done ? ' (Done)' : ''}
              </strong>
              <br />
              <a href={result.url} target="_blank" rel="noreferrer">
                Open in EdgeFocus →
              </a>
              {!result.verified && (
                <details>
                  <summary>Verification</summary>
                  <pre>
                    {result.verification
                      .map((c) => `${c.ok ? '✓' : '✗'} ${c.field}: ${c.expected} / ${c.actual}`)
                      .join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
