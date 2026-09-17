import { useEffect, useState } from 'react';
import { api, getPassword, setPassword, type ApiError, type DuplicateCandidate } from './api.js';
import { appendHistory, readHistory } from './history.js';
import { parseTaskInput } from '../parser/taskParser.js';
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

  useEffect(() => {
    api.health().then((h) => {
      if (!h) return;
      if (h.doneBucket) setDoneBucket(h.doneBucket);
      if (h.targetBucket) setTargetBucket(h.targetBucket);
      if (h.defaultAssignee) setDefaultAssignee(h.defaultAssignee);
      if (h.passwordRequired && !getPassword()) setNeedsPassword(true);
    });
  }, []);

  const runPreview = async (input: { text?: string; title?: string; date?: string; estimate?: string }) => {
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
  const quickCreate = async (text: string) => {
    const parsedInput = parseTaskInput(text);
    if (!parsedInput.assignee && defaultAssignee) parsedInput.assignee = defaultAssignee;
    if (!parsedInput.title) return;

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
      setResult(res.result);
      setStage('done');
      setHistory(appendHistory(res.result));
      setBoardKey((k) => k + 1);
    } catch (err) {
      handle(err as ApiError);
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
    } catch (err) {
      handle(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /** A 401 from the password gate sends the user back to the login screen. */
  const handle = (err: ApiError) => {
    if (err?.kind === 'password') {
      setNeedsPassword(true);
      setGateError('Неверный пароль.');
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
          onSubmitText={(text, quick) => (quick ? quickCreate(text) : runPreview({ text }))}
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

      <Board doneBucket={doneBucket} reloadKey={boardKey} />

      <MoveTask
        buckets={buckets.length ? buckets.map((b) => b.title) : [doneBucket]}
        doneBucket={doneBucket}
      />

      <RecentTasks items={history} />
    </main>
  );
}
