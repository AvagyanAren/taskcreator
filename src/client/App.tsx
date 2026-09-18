import { useEffect, useState } from 'react';
import { api, getPassword, setPassword, type ApiError, type DuplicateCandidate } from './api.js';
import { appendHistory, readHistory } from './history.js';
import { clearDraft } from './draft.js';
import { parseEditCommand, parseTaskInput, splitTasks } from '../parser/taskParser.js';
import { Toast } from './components/Toast.js';
import { PasswordGate } from './components/PasswordGate.js';
import { TaskForm } from './components/TaskForm.js';
import { TaskPreview } from './components/TaskPreview.js';
import { TaskResult } from './components/TaskResult.js';
import { RecentTasks } from './components/RecentTasks.js';
import { MoveTask } from './components/MoveTask.js';
import { Board } from './components/Board.js';
import type { CreatedTaskResult, HistoryEntry, ParsedTask } from '../types/edgefocus.js';

type Stage = 'form' | 'preview' | 'done';

export default function App() {
  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [bucket, setBucket] = useState('');
  const [buckets, setBuckets] = useState<Array<{ id: number; title: string }>>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [autoRouted, setAutoRouted] = useState(false);
  const [doneBucket, setDoneBucket] = useState('Выпущено');
  const [targetBucket, setTargetBucket] = useState('Дизайн');
  const [defaultAssignee, setDefaultAssignee] = useState('');
  const [result, setResult] = useState<CreatedTaskResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [needsPassword, setNeedsPassword] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [toast, setToast] = useState<{ message: string; href?: string; tone: 'ok' | 'warn' } | null>(
    null
  );

  useEffect(() => {
    api.health().then((h) => {
      if (!h) return;
      if (h.doneBucket) setDoneBucket(h.doneBucket);
      if (h.targetBucket) setTargetBucket(h.targetBucket);
      if (h.defaultAssignee) setDefaultAssignee(h.defaultAssignee);
      if (h.passwordRequired && !getPassword()) setNeedsPassword(true);
    });
  }, []);

  const runPreview = async (input: {
    text?: string;
    title?: string;
    date?: string;
    estimate?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    percentDone?: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const { parsed: p, targetBucket } = await api.parse(input);
      setParsed(p);
      setBucket(targetBucket);
      setDuplicates([]);
      setStage('preview');
      // Read-only preflight: resolve the real bucket and look for duplicates.
      const pre = await api.preflight(p.title, p.dueDate ?? null);
      setBucket(pre.bucket.title);
      setBuckets(pre.buckets);
      setAutoRouted(pre.autoRouted);
      setDuplicates(pre.duplicates);
    } catch (err) {
      handle(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ctrl+Enter path: parse locally and create in one request. The server still
   * checks for duplicates and answers `needsConfirmation` instead of creating
   * a second copy — in that case we fall back to the preview screen.
   */
  /**
   * "#249 прогресс 60%" edits an existing task instead of creating a new one.
   * Returns false when the input is not an edit command.
   */
  const tryEdit = async (text: string): Promise<boolean> => {
    const command = parseEditCommand(text);
    if (!command) return false;

    setBusy(true);
    setError(null);
    try {
      const { tasks } = await api.findTask(command.number);
      if (tasks.length === 0) {
        setError({ error: `Задача ${command.number} не найдена в проекте.`, kind: 'not_found' });
        return true;
      }
      if (tasks.length > 1) {
        setError({
          error: `Под номером ${command.number} нашлось несколько задач — уточните название.`,
          kind: 'validation',
          detail: tasks.map((t) => `${t.number} ${t.title}`).join('\n')
        });
        return true;
      }

      const updated = await api.updateTask(tasks[0].taskId, command.patch);
      setBoardKey((k) => k + 1);
      clearDraft();
      setToast({
        message: updated.verified
          ? `Обновлена: ${updated.title}`
          : `Обновлена, но проверка неполная: ${updated.title}`,
        href: updated.url,
        tone: updated.verified ? 'ok' : 'warn'
      });
      setResult(updated);
    } catch (err) {
      handle(err as ApiError, () => void tryEdit(text));
    } finally {
      setBusy(false);
    }
    return true;
  };

  const quickCreate = async (text: string) => {
    if (await tryEdit(text)) return;

    const blocks = splitTasks(text);

    // Several tasks separated by "---" are created in one request.
    if (blocks.length > 1) {
      const tasks = blocks
        .map((block) => {
          const parsedBlock = parseTaskInput(block);
          if (!parsedBlock.assignee && defaultAssignee) parsedBlock.assignee = defaultAssignee;
          return parsedBlock;
        })
        .filter((t) => t.title);
      if (tasks.length === 0) {
        setError({ error: 'Ни в одном блоке не распознано название задачи.', kind: 'validation' });
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const { results } = await api.batchCreate(tasks);
        const created = results.filter((r) => r.ok);
        for (const entry of created) setHistory(appendHistory(entry.result));
        setBoardKey((k) => k + 1);
        const failed = results.length - created.length;
        setToast({
          message: failed
            ? `Создано ${created.length} из ${results.length}. Не удалось: ${failed}.`
            : `Создано задач: ${created.length}`,
          tone: failed ? 'warn' : 'ok'
        });
        if (failed === 0) clearDraft();
      } catch (err) {
        handle(err as ApiError, () => void quickCreate(text));
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsedInput = parseTaskInput(text);
    if (!parsedInput.assignee && defaultAssignee) parsedInput.assignee = defaultAssignee;
    if (!parsedInput.title) {
      setError({
        error: 'Не удалось понять название задачи — в строке только дата и оценка.',
        kind: 'validation'
      });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await api.quickCreate(parsedInput);
      if (res.needsConfirmation) {
        setParsed(parsedInput);
        setBucket(res.bucket.title);
        setAutoRouted(res.autoRouted);
        setDuplicates(res.duplicates);
        const pre = await api.preflight(parsedInput.title, parsedInput.dueDate ?? null);
        setBuckets(pre.buckets);
        setStage('preview');
        return;
      }
      setHistory(appendHistory(res.result));
      setBoardKey((k) => k + 1);
      clearDraft();
      setToast({
        message: res.result.verified
          ? `Создана: ${res.result.title}`
          : `Создана, но проверка неполная: ${res.result.title}`,
        href: res.result.url,
        tone: res.result.verified ? 'ok' : 'warn'
      });
      setResult(res.result);
      setStage('form');
    } catch (err) {
      handle(err as ApiError, () => void quickCreate(text));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.create({ ...parsed, bucket });
      setResult(created);
      setStage('done');
      setHistory(appendHistory(created));
      setBoardKey((k) => k + 1);
      clearDraft();
    } catch (err) {
      handle(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /** A 401 from the password gate sends the user back to the login screen. */
  const handle = (err: ApiError, retryAction?: () => void) => {
    if (err?.kind === 'password') {
      setNeedsPassword(true);
      setGateError(getPassword() ? 'Неверный пароль.' : null);
      setRetry(() => retryAction ?? null);
      setError(null);
      return;
    }
    setError(err);
  };

  const reset = () => {
    setStage('form');
    setParsed(null);
    setResult(null);
    setError(null);
    setDuplicates([]);
    setAutoRouted(false);
  };

  if (needsPassword) {
    return (
      <main>
        <header>
          <h1>EdgeFocus — создание задач</h1>
        </header>
        <PasswordGate
          error={gateError}
          onSubmit={(value) => {
            setPassword(value);
            setNeedsPassword(false);
            setGateError(null);
            // Continue what the person was doing instead of making them retype it.
            const action = retry;
            setRetry(null);
            if (action) action();
          }}
        />
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>EdgeFocus — создание задач</h1>
      </header>

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

      {stage === 'form' && (
        <TaskForm
          busy={busy}
          bucket={targetBucket}
          defaultAssignee={defaultAssignee}
          onSubmitText={(text, quick) => {
            // An edit command goes straight through — there is nothing to preview.
            if (parseEditCommand(text)) return void quickCreate(text);
            return quick ? quickCreate(text) : runPreview({ text });
          }}
          onSubmitStructured={(input) => runPreview(input)}
        />
      )}

      {stage === 'preview' && parsed && (
        <TaskPreview
          parsed={parsed}
          bucket={bucket}
          buckets={buckets}
          onBucketChange={(b) => {
            setBucket(b);
            setAutoRouted(false);
          }}
          autoRouted={autoRouted}
          onAssigneeClear={() => setParsed({ ...parsed, assignee: null })}
          onChange={(patch) => setParsed({ ...parsed, ...patch })}
          duplicates={duplicates}
          busy={busy}
          onConfirm={confirm}
          onCancel={reset}
        />
      )}

      {stage === 'done' && result && <TaskResult result={result} onReset={reset} />}

      {toast && (
        <Toast
          message={toast.message}
          href={toast.href}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      )}

      <Board doneBucket={doneBucket} reloadKey={boardKey} />

      <MoveTask
        buckets={buckets.length ? buckets.map((b) => b.title) : [doneBucket]}
        doneBucket={doneBucket}
      />

      <RecentTasks items={history} />
    </main>
  );
}
