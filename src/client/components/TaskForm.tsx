import { useEffect, useMemo, useState } from 'react';
import { readDraft, saveDraft } from '../draft.js';
import { parseTaskInput } from '../../parser/taskParser.js';
import { ParsePreviewChips } from './ParsePreviewChips.js';

interface Props {
  busy: boolean;
  bucket: string;
  defaultAssignee: string;
  onSubmitText: (text: string, quick?: boolean) => void;
  onSubmitStructured: (input: {
    title: string;
    date: string;
    estimate: string;
    description: string;
  }) => void;
}

const ESTIMATES = ['', '5m', '15m', '30m', '45m', '1h', '1h 30m', '2h', '3h', '4h', '6h', '8h'];

export function TaskForm({
  busy,
  bucket,
  defaultAssignee,
  onSubmitText,
  onSubmitStructured
}: Props) {
  const initial = useMemo(() => readDraft(), []);
  const [mode, setMode] = useState<'nl' | 'fields'>(initial.mode);
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [estimate, setEstimate] = useState(initial.estimate);
  const [customEstimate, setCustomEstimate] = useState('');
  const [description, setDescription] = useState(initial.description);

  // Persist the draft so a password prompt or a reload never eats the input.
  useEffect(() => {
    saveDraft({ text, title, date, estimate, description, mode });
  }, [text, title, date, estimate, description, mode]);

  // The parser is plain TypeScript, so it runs in the browser too: the preview
  // updates as you type, with no request to the server.
  const live = useMemo(() => {
    const parsed = parseTaskInput(text);
    if (!parsed.assignee && defaultAssignee) parsed.assignee = defaultAssignee;
    return parsed;
  }, [text, defaultAssignee]);

  return (
    <div className="card">
      <div className="tabs">
        <button className={mode === 'nl' ? 'tab active' : 'tab'} onClick={() => setMode('nl')}>
          Обычным языком
        </button>
        <button className={mode === 'fields' ? 'tab active' : 'tab'} onClick={() => setMode('fields')}>
          По полям
        </button>
      </div>

      {mode === 'nl' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onSubmitText(text);
          }}
        >
          <label htmlFor="nl">Что нужно сделать?</label>
          <textarea
            id="nl"
            rows={3}
            value={text}
            placeholder={'Сделать адаптивную версию страницы Business, 25 сентября, 2h\nОписание с новой строки — попадёт в Description'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim()) {
                e.preventDefault();
                onSubmitText(text, true);
              }
            }}
          />
          <ParsePreviewChips parsed={live} bucket={bucket} />
          <p className="hint">
            Дата и estimate распознаются автоматически: «завтра», «25 сентября», «20.09», «2h»,
            «1.5 часа», «30 мин». Исполнитель — «@aren» или «assign Aren».
            <br />
            Описание — со второй строки (Shift+Enter) или после слова «описание:».
            <br />
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> — создать сразу, минуя подтверждение.
          </p>
          <button className="primary" type="submit" disabled={busy || !text.trim()}>
            Создать задачу
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              onSubmitStructured({
                title,
                date,
                estimate: estimate === 'custom' ? customEstimate : estimate,
                description
              });
            }
          }}
        >
          <label htmlFor="title">Название задачи</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label htmlFor="desc">Описание (необязательно)</label>
          <textarea
            id="desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <label htmlFor="date">Дата</label>
          <input
            id="date"
            value={date}
            placeholder="25.09.2026 / 25 сентября / завтра"
            onChange={(e) => setDate(e.target.value)}
          />

          <label htmlFor="estimate">Estimate</label>
          <select id="estimate" value={estimate} onChange={(e) => setEstimate(e.target.value)}>
            {ESTIMATES.map((v) => (
              <option key={v || 'none'} value={v}>
                {v || 'не указан'}
              </option>
            ))}
            <option value="custom">своё значение…</option>
          </select>
          {estimate === 'custom' && (
            <input
              value={customEstimate}
              placeholder="90m / 2.5h"
              onChange={(e) => setCustomEstimate(e.target.value)}
            />
          )}

          <button className="primary" type="submit" disabled={busy || !title.trim()}>
            Создать задачу
          </button>
        </form>
      )}
    </div>
  );
}
