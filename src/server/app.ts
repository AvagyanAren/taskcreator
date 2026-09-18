import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EdgeFocusClient, EdgeFocusError } from '../api/edgefocus.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { parseDateInput, parseEstimate, parseTaskInput } from '../parser/taskParser.js';
import { TaskService } from '../services/taskService.js';
import type { ParsedTask } from '../types/edgefocus.js';
import { passwordMatches } from './password.js';

/** Reads a task payload sent by the client, including its timezone offset. */
function readTaskBody(body: Record<string, unknown>): { parsed: ParsedTask; tz: number } {
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v);
  return {
    parsed: {
      title: String(body.title ?? '').trim(),
      dueDate: body.dueDate ? String(body.dueDate) : null,
      startDate: body.startDate ? String(body.startDate) : null,
      startTime: body.startTime ? String(body.startTime) : null,
      endTime: body.endTime ? String(body.endTime) : null,
      percentDone: num(body.percentDone),
      labels: Array.isArray(body.labels) ? body.labels.map((l) => String(l)) : undefined,
      priority: num(body.priority),
      estimateMinutes: num(body.estimateMinutes),
      assignee: body.assignee ? String(body.assignee) : null,
      bucket: body.bucket ? String(body.bucket) : null,
      description: body.description ? String(body.description) : null
    },
    tz: Number.isFinite(Number(body.tzOffsetMinutes)) ? Number(body.tzOffsetMinutes) : 0
  };
}

/**
 * Optional shared-password gate. Without APP_PASSWORD the app stays open,
 * which is fine locally but must never be the case on a public URL.
 */
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();

function requirePassword(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!APP_PASSWORD) return next();
  if (req.path === '/api/health') return next();
  const supplied = String(req.header('x-app-password') || '');
  if (passwordMatches(APP_PASSWORD, supplied)) return next();
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
    if (typeof req.body?.startTime === 'string' && req.body.startTime.trim()) {
      parsed.startTime = req.body.startTime.trim();
    }
    if (typeof req.body?.endTime === 'string' && req.body.endTime.trim()) {
      parsed.endTime = req.body.endTime.trim();
    }
    if (req.body?.percentDone !== undefined && req.body.percentDone !== null && req.body.percentDone !== '') {
      const value = Number(req.body.percentDone);
      if (Number.isFinite(value)) parsed.percentDone = Math.max(0, Math.min(100, value));
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
    const { parsed, tz } = readTaskBody((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.title) {
      return res.status(400).json({ error: 'Укажите название задачи.', kind: 'validation' });
    }
    const result = await service().createTask(parsed, tz);
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
        const { groups, stats } = await svc.listBoard(30);
        return `получено ${stats.received}, открытых ${stats.open}, с колонкой ${stats.resolved} (${stats.source}), групп ${groups.length}`;
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
      const { groups, stats } = await service().listBoard(50);
      res.json({
        doneBucket: config.doneBucket,
        stats,
        groups: groups.map((g) => ({
          bucket: g.bucket.title,
          tasks: g.tasks.map((t) => ({
            taskId: t.id,
            number: t.identifier || (t.index ? `#${t.index}` : `#${t.id}`),
            title: t.title,
            dueDate: t.end_date ?? null,
            estimateMinutes: t.time_estimate ?? null,
            percentDone: t.percent_done === undefined || t.percent_done === null
              ? null
              : t.percent_done <= 1
                ? Math.round(t.percent_done * 100)
                : Math.round(t.percent_done),
            url: `${config.webUrl}/tasks/${t.id}`
          }))
        }))
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Look up a task by card number (#249) or title. */
  app.post('/api/tasks/find', async (req, res) => {
    try {
      const query = String(req.body?.query ?? '').trim();
      if (!query) return res.json({ tasks: [] });
      const svc = service();
      const byNumber = /^#?\d+$/.test(query) ? await svc.findByNumber(query) : [];
      const tasks = byNumber.length > 0 ? byNumber : await svc.findTask(query);
      res.json({
        tasks: tasks.map((t) => ({
          taskId: t.id,
          number: t.identifier || (t.index ? `#${t.index}` : `#${t.id}`),
          title: t.title,
          done: Boolean(t.done),
          url: `${config.webUrl}/tasks/${t.id}`
        }))
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Apply a partial change to an existing task. */
  app.post('/api/tasks/:id/update', async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      if (!Number.isFinite(taskId)) {
        return res.status(400).json({ error: 'Некорректный ID задачи.', kind: 'validation' });
      }
      const { parsed, tz } = readTaskBody((req.body ?? {}) as Record<string, unknown>);
      res.json(await service().updateExistingTask(taskId, parsed, tz));
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Create several tasks in one go; each result is reported separately. */
  app.post('/api/tasks/batch', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
      if (items.length === 0) {
        return res.status(400).json({ error: 'Список задач пуст.', kind: 'validation' });
      }
      if (items.length > 20) {
        return res
          .status(400)
          .json({ error: 'За один раз можно создать не больше 20 задач.', kind: 'validation' });
      }

      const svc = service();
      const results: Array<
        | { ok: true; result: Awaited<ReturnType<TaskService['createTask']>> }
        | { ok: false; title: string; error: string }
      > = [];

      // Sequential on purpose: EdgeFocus stays responsive and duplicate
      // detection sees tasks created moments earlier.
      for (const item of items) {
        const { parsed, tz } = readTaskBody(item as Record<string, unknown>);
        if (!parsed.title) continue;
        try {
          results.push({ ok: true, result: await svc.createTask(parsed, tz) });
        } catch (err) {
          results.push({
            ok: false,
            title: parsed.title,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      res.json({ results });
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
      const { parsed, tz } = readTaskBody((req.body ?? {}) as Record<string, unknown>);
      const force = Boolean((req.body ?? {}).force);
      if (!parsed.title) {
        return res.status(400).json({ error: 'Укажите название задачи.', kind: 'validation' });
      }

      const svc = service();
      const duplicates = await svc.findPossibleDuplicates(parsed.title);
      if (duplicates.length > 0 && !force) {
        const decided = await svc.decideBucket(parsed);
        return res.json({
          needsConfirmation: true,
          duplicates,
          bucket: { id: decided.bucket.id, title: decided.bucket.title },
          autoRouted: decided.auto
        });
      }

      const result = await svc.createTask(parsed, tz);
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
