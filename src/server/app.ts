import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EdgeFocusClient, EdgeFocusError } from '../api/edgefocus.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { parseDateInput, parseEstimate, parseTaskInput } from '../parser/taskParser.js';
import { TaskService } from '../services/taskService.js';
import type { ParsedTask } from '../types/edgefocus.js';

/**
 * Optional shared-password gate. Without APP_PASSWORD the app stays open,
 * which is fine locally but must never be the case on a public URL.
 */
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();

function requirePassword(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!APP_PASSWORD) return next();
  if (req.path === '/api/health') return next();
  const supplied = String(req.header('x-app-password') || '');
  if (supplied && supplied === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'Требуется пароль.', kind: 'password' });
}

export const config = loadConfig();

/** Lazily built so a missing token produces a clean API error, not a crash. */
function service(): TaskService {
  return new TaskService(new EdgeFocusClient(config));
}

function sendError(res: express.Response, err: unknown) {
  if (err instanceof ConfigError) {
    return res.status(500).json({ error: err.message, kind: 'config' });
  }
  if (err instanceof EdgeFocusError) {
    const status =
      err.kind === 'auth' ? 401 : err.kind === 'forbidden' ? 403 : err.kind === 'not_found' ? 404 : err.kind === 'validation' ? 400 : 502;
    return res.status(status).json({ error: err.message, kind: err.kind, detail: err.detail });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: 'Unexpected error.', kind: 'unknown', detail: message });
}

/** Builds the Express app. Used by the local server and by the Vercel function. */
export function createApp() {
  const app = express();

  /**
   * Vercel's Node runtime already consumes the request stream and hands over a
   * parsed `req.body`. Running express.json() on top of that would wait for a
   * stream that will never emit again, so the request hangs until the function
   * times out. Locally there is no pre-parsed body and the parser runs as usual.
   */
  const jsonParser = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    const pre = (req as express.Request & { body?: unknown }).body;
    if (pre !== undefined && pre !== null) return next();
    jsonParser(req, res, next);
  });

  app.use(requirePassword);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    passwordRequired: Boolean(APP_PASSWORD),
    tokenConfigured: Boolean(process.env.EDGEFOCUS_TOKEN?.trim()),
    projectId: config.projectId,
    kanbanViewId: config.kanbanViewId,
    targetBucket: config.targetBucket,
    doneBucket: config.doneBucket,
    defaultAssignee: config.defaultAssignee
  });
});

/** Natural-language / structured parsing — no API calls, no side effects. */
app.post('/api/parse', (req, res) => {
  const { text, title, date, estimate, description } = req.body ?? {};
  try {
    let parsed: ParsedTask;
    if (typeof text === 'string' && text.trim()) {
      parsed = parseTaskInput(text);
    } else {
      parsed = { title: '', dueDate: null, estimateMinutes: null, assignee: null };
    }
    if (typeof title === 'string' && title.trim()) parsed.title = title.trim();
    if (typeof description === 'string' && description.trim()) {
      parsed.description = description.trim();
    }
    if (typeof date === 'string' && date.trim()) parsed.dueDate = parseDateInput(date);
    if (typeof estimate === 'string' && estimate.trim()) {
      parsed.estimateMinutes = parseEstimate(estimate);
    }
    // Show the configured default assignee in the preview, so nothing is
    // applied silently at creation time.
    if (!parsed.assignee && config.defaultAssignee) {
      parsed.assignee = config.defaultAssignee;
    }
    res.json({ parsed, targetBucket: config.targetBucket });
  } catch (err) {
    sendError(res, err);
  }
});

/** Read-only preflight: bucket resolution + duplicate check. */
app.post('/api/preflight', async (req, res) => {
  try {
    const svc = service();
    const title = String(req.body?.title ?? '').trim();
    const requested = String(req.body?.bucket ?? '').trim();
    const dueDate = req.body?.dueDate ? String(req.body.dueDate) : null;
    const buckets = await svc.listBuckets();
    const decided = await svc.decideBucket({
      title,
      dueDate,
      estimateMinutes: null,
      assignee: null,
      bucket: requested || null
    });
    const duplicates = title ? await svc.findPossibleDuplicates(title) : [];
    res.json({
      bucket: { id: decided.bucket.id, title: decided.bucket.title },
      autoRouted: decided.auto,
      buckets: buckets.map((b) => ({ id: b.id, title: b.title })),
      duplicates
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** Create + move + verify. */
app.post('/api/tasks', async (req, res) => {
  try {
    const body = req.body ?? {};
    const parsed: ParsedTask = {
      title: String(body.title ?? '').trim(),
      dueDate: body.dueDate ? String(body.dueDate) : null,
      estimateMinutes:
        body.estimateMinutes === null || body.estimateMinutes === undefined
          ? null
          : Number(body.estimateMinutes),
      assignee: body.assignee ? String(body.assignee) : null,
      bucket: body.bucket ? String(body.bucket) : null,
      description: body.description ? String(body.description) : null
    };
    if (!parsed.title) {
      return res.status(400).json({ error: 'Укажите название задачи.', kind: 'validation' });
    }
    const result = await service().createTask(parsed);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/** Search existing tasks by id or title. */
  /** Diagnostics: is EdgeFocus reachable, and how slow is it? */
  app.get('/api/diag', async (_req, res) => {
    const steps: Array<{ step: string; ms: number; ok: boolean; info?: string }> = [];
    const time = async (step: string, fn: () => Promise<string>) => {
      const started = Date.now();
      try {
        const info = await fn();
        steps.push({ step, ms: Date.now() - started, ok: true, info });
      } catch (err) {
        steps.push({
          step,
          ms: Date.now() - started,
          ok: false,
          info: err instanceof Error ? err.message : String(err)
        });
      }
    };

    try {
      const svc = service();
      await time('buckets', async () => `${(await svc.listBuckets()).length} колонок`);
      await time('bucket по имени', async () => (await svc.resolveTargetBucket()).title);
      await time('доска', async () => {
        const groups = await svc.listBoard(30);
        return `${groups.reduce((n, g) => n + g.tasks.length, 0)} задач`;
      });
      if (config.defaultAssignee) {
        await time('исполнитель', async () => {
          const { user } = await svc.resolveAssigneeDetailed(config.defaultAssignee);
          return user ? user.username : 'не найден';
        });
      }
      res.json({ ok: steps.every((s) => s.ok), totalMs: steps.reduce((n, s) => n + s.ms, 0), steps });
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Current board: open tasks grouped by column. */
  app.get('/api/board', async (_req, res) => {
    try {
      const groups = await service().listBoard(50);
      res.json({
        doneBucket: config.doneBucket,
        groups: groups.map((g) => ({
          bucket: g.bucket.title,
          tasks: g.tasks.map((t) => ({
            taskId: t.id,
            title: t.title,
            dueDate: t.end_date ?? null,
            estimateMinutes: t.time_estimate ?? null,
            url: `${config.webUrl}/tasks/${t.id}`
          }))
        }))
      });
    } catch (err) {
      sendError(res, err);
    }
  });

app.post('/api/tasks/search', async (req, res) => {
  try {
    const q = String(req.body?.query ?? '').trim();
    if (!q) return res.json({ tasks: [] });
    const svc = service();
    const tasks = await svc.findTask(q);
    res.json({
      tasks: tasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        done: Boolean(t.done),
        url: `${config.webUrl}/tasks/${t.id}`
      }))
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** Move an existing task into a column, ignoring its dates. */
app.post('/api/tasks/:id/move', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ error: 'Некорректный ID задачи.', kind: 'validation' });
    }
    const bucket = req.body?.bucket ? String(req.body.bucket) : undefined;
    res.json(await service().moveTask(taskId, bucket));
  } catch (err) {
    sendError(res, err);
  }
});

  /**
   * One-shot create: resolves the column, checks for duplicates and creates
   * the task in a single round trip. If a possible duplicate turns up, nothing
   * is created — the client is asked to confirm instead.
   */
  app.post('/api/tasks/quick', async (req, res) => {
    try {
      const body = req.body ?? {};
      const parsed: ParsedTask = {
        title: String(body.title ?? '').trim(),
        dueDate: body.dueDate ? String(body.dueDate) : null,
        estimateMinutes:
          body.estimateMinutes === null || body.estimateMinutes === undefined
            ? null
            : Number(body.estimateMinutes),
        assignee: body.assignee ? String(body.assignee) : null,
        bucket: body.bucket ? String(body.bucket) : null,
        description: body.description ? String(body.description) : null
      };
      if (!parsed.title) {
        return res.status(400).json({ error: 'Укажите название задачи.', kind: 'validation' });
      }

      const svc = service();
      const duplicates = await svc.findPossibleDuplicates(parsed.title);
      if (duplicates.length > 0 && !body.force) {
        const decided = await svc.decideBucket(parsed);
        return res.json({
          needsConfirmation: true,
          duplicates,
          bucket: { id: decided.bucket.id, title: decided.bucket.title },
          autoRouted: decided.auto
        });
      }

      const result = await svc.createTask(parsed);
      res.json({ needsConfirmation: false, result });
    } catch (err) {
      sendError(res, err);
    }
  });

/** Diagnostics: who does EdgeFocus return for this name? */
app.post('/api/users/lookup', async (req, res) => {
  try {
    const q = String(req.body?.query ?? config.defaultAssignee ?? '').trim();
    const { user, candidates } = await service().resolveAssigneeDetailed(q);
    res.json({
      query: q,
      matched: user ? { id: user.id, username: user.username, name: user.name } : null,
      candidates: candidates.map((u) => ({ id: u.id, username: u.username, name: u.name }))
    });
  } catch (err) {
    sendError(res, err);
  }
});

  // Serve the built frontend when running `npm run build && npm start`.
  const staticDir = resolve(process.cwd(), 'dist/public');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  return app;
}
