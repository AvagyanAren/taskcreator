import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end tests of the HTTP layer, driven twice:
 *  - "local": Express reads the request stream itself;
 *  - "vercel": the body is already parsed and the stream is exhausted,
 *    which is exactly what broke every POST in production once.
 */
let edgefocus: http.Server;
let edgefocusUrl: string;
let app: http.Server;
let appUrl: string;
let mode: 'local' | 'vercel' = 'local';

let nextId = 26300;
let nextIndex = 300;
const tasks = new Map<number, Record<string, unknown>>();
const taskBucket = new Map<number, number>();
const buckets = [
  { id: 679, title: 'Дизайн', project_view_id: 765 },
  { id: 677, title: 'Выпущено', project_view_id: 765 }
];

beforeAll(async () => {
  edgefocus = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const path = url.pathname;

    if (path === '/api/v1/projects') return send(200, [{ id: 176, title: 'Разработка' }]);
    if (path === '/api/v1/projects/176') return send(200, { id: 176, title: 'Разработка' });
    if (path === '/api/v1/projects/176/views/765/buckets') return send(200, buckets);
    if (path === '/api/v1/projects/176/views/765') {
      return send(200, { id: 765, project_id: 176, done_bucket_id: 677 });
    }
    if (path === '/api/v1/projects/176/projectusers') return send(200, []);
    if (path === '/api/v1/labels') return send(200, []);

    if (path === '/api/v1/projects/176/tasks' && req.method === 'PUT') {
      const task = {
        id: ++nextId,
        index: ++nextIndex,
        identifier: `#${nextIndex}`,
        title: body.title,
        project_id: 176,
        done: false,
        end_date: body.end_date ?? '0001-01-01T00:00:00Z',
        start_date: body.start_date ?? '0001-01-01T00:00:00Z',
        time_estimate: body.time_estimate ?? 0,
        percent_done: 0,
        bucket_id: 0
      };
      tasks.set(task.id, task);
      return send(201, task);
    }

    let match = path.match(/^\/api\/v1\/tasks\/(\d+)$/);
    if (match && req.method === 'GET') {
      const task = tasks.get(Number(match[1]));
      if (!task) return send(404, {});
      const expand = url.searchParams.get('expand') ?? '';
      const out: Record<string, unknown> = { ...task, bucket_id: 0 };
      if (expand.includes('buckets')) {
        const id = taskBucket.get(Number(match[1]));
        out.buckets = id ? [buckets.find((b) => b.id === id)] : [];
      }
      return send(200, out);
    }
    if (match && req.method === 'POST') {
      const task = tasks.get(Number(match[1]));
      if (!task) return send(404, {});
      for (const key of ['title', 'end_date', 'start_date', 'time_estimate', 'priority']) {
        if (body[key] !== undefined) task[key] = body[key];
      }
      if (body.percent_done !== undefined && body.percent_done > 1) task.percent_done = body.percent_done;
      if (body.bucket_id) taskBucket.set(Number(match[1]), Number(body.bucket_id));
      return send(200, task);
    }

    match = path.match(/^\/api\/v1\/projects\/176\/views\/765\/buckets\/(\d+)\/tasks$/);
    if (match && req.method === 'POST') {
      taskBucket.set(Number(body.task_id), Number(match[1]));
      return send(200, body);
    }
    if (/^\/api\/v1\/tasks\/\d+\/assignees$/.test(path)) return send(200, []);
    if (/^\/api\/v1\/tasks\/\d+\/labels$/.test(path)) return send(200, []);
    if (/^\/api\/v1\/projects\/176\/views\/\d+\/tasks$/.test(path)) return send(200, [...tasks.values()]);
    return send(404, { message: `no route ${path}` });
  });
  await new Promise<void>((resolve) => edgefocus.listen(0, resolve));
  edgefocusUrl = `http://localhost:${(edgefocus.address() as AddressInfo).port}/api/v1`;

  process.env.EDGEFOCUS_BASE_URL = edgefocusUrl;
  process.env.EDGEFOCUS_TOKEN = 'test-token';
  process.env.EDGEFOCUS_PROJECT_ID = '176';
  process.env.EDGEFOCUS_KANBAN_VIEW_ID = '765';
  process.env.EDGEFOCUS_TABLE_VIEW_ID = '764';
  process.env.EDGEFOCUS_TARGET_BUCKET = 'Дизайн';
  process.env.EDGEFOCUS_DONE_BUCKET = 'Выпущено';
  process.env.EDGEFOCUS_DEFAULT_ASSIGNEE = '';
  process.env.APP_PASSWORD = 'Пароль123';

  const { createApp } = await import('./app.js');
  const expressApp = createApp();

  app = http.createServer((req, res) => {
    if (mode === 'local') return (expressApp as unknown as http.RequestListener)(req, res);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (raw && (req.headers['content-type'] ?? '').includes('json')) {
        try {
          (req as http.IncomingMessage & { body?: unknown }).body = JSON.parse(raw);
        } catch {
          (req as http.IncomingMessage & { body?: unknown }).body = {};
        }
      }
      (expressApp as unknown as http.RequestListener)(req, res);
    });
  });
  await new Promise<void>((resolve) => app.listen(0, resolve));
  appUrl = `http://localhost:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => app.close(() => resolve()));
  await new Promise<void>((resolve) => edgefocus.close(() => resolve()));
});

beforeEach(() => {
  tasks.clear();
  taskBucket.clear();
});

const PASSWORD = encodeURIComponent('Пароль123');

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': PASSWORD,
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

for (const runMode of ['local', 'vercel'] as const) {
  describe(`HTTP (${runMode})`, () => {
    beforeEach(() => {
      mode = runMode;
    });

    it('health отвечает без пароля', async () => {
      const res = await fetch(`${appUrl}/api/health`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.passwordRequired).toBe(true);
      expect(body.tokenConfigured).toBe(true);
    });

    it('без пароля — 401', async () => {
      const res = await fetch(`${appUrl}/api/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Задача, завтра, 1h' })
      });
      expect(res.status).toBe(401);
    });

    it('парсинг строки', async () => {
      const { status, body } = await call('/api/parse', {
        method: 'POST',
        body: JSON.stringify({ text: 'Починить фильтры #багфикс !важно, 25 сентября, 2h, 40%' })
      });
      expect(status).toBe(200);
      expect(body.parsed.title).toBe('Починить фильтры');
      expect(body.parsed.estimateMinutes).toBe(120);
      expect(body.parsed.percentDone).toBe(40);
      expect(body.parsed.priority).toBe(3);
      expect(body.parsed.labels).toEqual(['багфикс']);
    });

    it('быстрое создание', async () => {
      const { status, body } = await call('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ title: 'Быстрая задача', dueDate: '2026-12-25', estimateMinutes: 120 })
      });
      expect(status).toBe(200);
      expect(body.needsConfirmation).toBe(false);
      expect(body.result.verified).toBe(true);
      expect(body.result.bucket).toBe('Дизайн');
    });

    it('повтор названия требует подтверждения и не создаёт дубликат', async () => {
      const payload = JSON.stringify({ title: 'Дубликат', dueDate: '2026-12-25', estimateMinutes: 60 });
      await call('/api/tasks/quick', { method: 'POST', body: payload });
      const created = tasks.size;

      const second = await call('/api/tasks/quick', { method: 'POST', body: payload });
      expect(second.body.needsConfirmation).toBe(true);
      expect(second.body.duplicates.length).toBeGreaterThan(0);
      expect(tasks.size).toBe(created);

      const forced = await call('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ title: 'Дубликат', dueDate: '2026-12-25', estimateMinutes: 60, force: true })
      });
      expect(forced.body.needsConfirmation).toBe(false);
      expect(tasks.size).toBe(created + 1);
    });

    it('пакетное создание', async () => {
      const { status, body } = await call('/api/tasks/batch', {
        method: 'POST',
        body: JSON.stringify({
          tasks: [
            { title: 'Пакет 1', dueDate: '2026-12-20', estimateMinutes: 60 },
            { title: 'Пакет 2', dueDate: '2026-12-21', estimateMinutes: 120 }
          ]
        })
      });
      expect(status).toBe(200);
      expect(body.results).toHaveLength(2);
      expect(body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    });

    it('пустой пакет отклоняется', async () => {
      const { status } = await call('/api/tasks/batch', {
        method: 'POST',
        body: JSON.stringify({ tasks: [] })
      });
      expect(status).toBe(400);
    });

    it('поиск по номеру карточки и правка', async () => {
      const created = await call('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ title: 'Задача для правки', dueDate: '2026-12-25', estimateMinutes: 60 })
      });
      const number = `#${nextIndex}`;

      const found = await call('/api/tasks/find', {
        method: 'POST',
        body: JSON.stringify({ query: number })
      });
      expect(found.body.tasks).toHaveLength(1);
      expect(found.body.tasks[0].taskId).toBe(created.body.result.taskId);

      const updated = await call(`/api/tasks/${created.body.result.taskId}/update`, {
        method: 'POST',
        body: JSON.stringify({ percentDone: 60, estimateMinutes: 240 })
      });
      expect(updated.status).toBe(200);
      expect(updated.body.verified).toBe(true);
      expect(updated.body.percentDone).toBe(60);
      expect(updated.body.estimateMinutes).toBe(240);
    });

    it('доска отдаёт группы', async () => {
      await call('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ title: 'На доске', dueDate: '2026-12-25', estimateMinutes: 60 })
      });
      const { status, body } = await call('/api/board');
      expect(status).toBe(200);
      expect(body.groups.length).toBeGreaterThan(0);
      expect(body.groups[0].tasks[0].number).toMatch(/^#\d+$/);
    });

    it('перенос в другую колонку', async () => {
      const created = await call('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ title: 'Перенести', dueDate: '2026-12-25', estimateMinutes: 60 })
      });
      const { status, body } = await call(`/api/tasks/${created.body.result.taskId}/move`, {
        method: 'POST',
        body: JSON.stringify({ bucket: 'Выпущено' })
      });
      expect(status).toBe(200);
      expect(body.bucket).toBe('Выпущено');
      expect(body.verification[0].ok).toBe(true);
    });

    it('задача без названия отклоняется', async () => {
      const { status } = await call('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: '   ' })
      });
      expect(status).toBe(400);
    });

    it('диагностика проходит', async () => {
      const { status, body } = await call('/api/diag');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });
}
