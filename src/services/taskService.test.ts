import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EdgeFocusClient } from '../api/edgefocus.js';
import { TaskService } from './taskService.js';
import { clearCache } from './cache.js';

/**
 * Integration tests against a stand-in EdgeFocus. The fake deliberately
 * reproduces the awkward behaviour of the real API:
 *  - `bucket_id` always comes back as 0;
 *  - `percent_done` is stored as whole percents and a fraction is ignored;
 *  - the card number (`index`) differs from the API `id`.
 */
let server: http.Server;
let baseUrl: string;

let nextId = 26200;
let nextIndex = 248;
let nextLabelId = 10;
const tasks = new Map<number, Record<string, unknown>>();
const labels = new Map<number, { id: number; title: string }>();
const taskLabels = new Map<number, number[]>();
const taskBucket = new Map<number, number>();
const buckets = [
  { id: 679, title: 'Дизайн', project_view_id: 765 },
  { id: 677, title: 'Выпущено', project_view_id: 765 }
];

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const path = url.pathname;

    if (path === '/api/v1/projects/176/views/765/buckets') return send(200, buckets);
    if (path === '/api/v1/projects/176/views/765') {
      return send(200, { id: 765, project_id: 176, done_bucket_id: 677 });
    }
    if (path === '/api/v1/projects/176/projectusers') return send(200, []);

    if (path === '/api/v1/labels' && req.method === 'GET') {
      const q = (url.searchParams.get('s') ?? '').toLowerCase();
      return send(200, [...labels.values()].filter((l) => !q || l.title.toLowerCase().includes(q)));
    }
    if (path === '/api/v1/labels' && req.method === 'PUT') {
      const label = { id: ++nextLabelId, title: String(body.title) };
      labels.set(label.id, label);
      return send(201, label);
    }

    let match = path.match(/^\/api\/v1\/tasks\/(\d+)\/labels$/);
    if (match && req.method === 'GET') {
      return send(200, (taskLabels.get(Number(match[1])) ?? []).map((id) => labels.get(id)));
    }
    if (match && req.method === 'PUT') {
      const list = taskLabels.get(Number(match[1])) ?? [];
      list.push(Number(body.label_id));
      taskLabels.set(Number(match[1]), list);
      return send(201, {});
    }

    if (path === '/api/v1/projects/176/tasks' && req.method === 'PUT') {
      const task: Record<string, unknown> = {
        id: ++nextId,
        index: ++nextIndex,
        identifier: `#${nextIndex}`,
        title: body.title,
        project_id: 176,
        done: false,
        end_date: body.end_date ?? '0001-01-01T00:00:00Z',
        start_date: body.start_date ?? '0001-01-01T00:00:00Z',
        time_estimate: body.time_estimate ?? 0,
        priority: body.priority ?? 0,
        // a fraction is silently dropped — the service must notice and retry
        percent_done: typeof body.percent_done === 'number' && body.percent_done > 1 ? body.percent_done : 0,
        bucket_id: 0
      };
      tasks.set(task.id as number, task);
      return send(201, task);
    }

    match = path.match(/^\/api\/v1\/tasks\/(\d+)$/);
    if (match && req.method === 'GET') {
      const task = tasks.get(Number(match[1]));
      if (!task) return send(404, {});
      const expand = url.searchParams.get('expand') ?? '';
      const result: Record<string, unknown> = { ...task, bucket_id: 0 };
      if (expand.includes('buckets')) {
        const id = taskBucket.get(Number(match[1]));
        result.buckets = id ? [buckets.find((b) => b.id === id)] : [];
      }
      return send(200, result);
    }
    if (match && req.method === 'POST') {
      const task = tasks.get(Number(match[1]));
      if (!task) return send(404, {});
      for (const key of ['title', 'end_date', 'start_date', 'time_estimate', 'priority', 'description']) {
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
    if (/^\/api\/v1\/projects\/176\/views\/\d+\/tasks$/.test(path)) return send(200, [...tasks.values()]);
    return send(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}/api/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function makeService(): TaskService {
  process.env.EDGEFOCUS_BASE_URL = baseUrl;
  process.env.EDGEFOCUS_TOKEN = 'test-token';
  process.env.EDGEFOCUS_PROJECT_ID = '176';
  process.env.EDGEFOCUS_KANBAN_VIEW_ID = '765';
  process.env.EDGEFOCUS_TABLE_VIEW_ID = '764';
  process.env.EDGEFOCUS_TARGET_BUCKET = 'Дизайн';
  process.env.EDGEFOCUS_DONE_BUCKET = 'Выпущено';
  process.env.EDGEFOCUS_DEFAULT_ASSIGNEE = '';
  clearCache();
  return new TaskService(new EdgeFocusClient());
}

beforeEach(() => {
  tasks.clear();
  labels.clear();
  taskLabels.clear();
  taskBucket.clear();
  clearCache();
});

describe('создание задачи', () => {
  it('метки, приоритет и прогресс сохраняются и проверяются', async () => {
    const svc = makeService();
    const result = await svc.createTask({
      title: 'Починить фильтры',
      dueDate: '2026-09-25',
      estimateMinutes: 120,
      assignee: null,
      labels: ['багфикс', 'mobile'],
      priority: 4,
      percentDone: 25
    });

    expect(result.verified).toBe(true);
    expect(result.bucket).toBe('Дизайн');
    expect(result.percentDone).toBe(25);
    const fields = result.verification.map((c) => c.field);
    expect(fields).toContain('Метки');
    expect(fields).toContain('Приоритет');
    expect(result.verification.every((c) => c.ok)).toBe(true);
  });

  it('прошедшая дата уводит задачу в done-колонку', async () => {
    const svc = makeService();
    const result = await svc.createTask({
      title: 'Старая задача',
      dueDate: '2020-01-01',
      estimateMinutes: 30,
      assignee: null
    });
    expect(result.bucket).toBe('Выпущено');
  });

  it('время начала и конца уходит в UTC по смещению', async () => {
    const svc = makeService();
    const result = await svc.createTask(
      {
        title: 'Созвон',
        dueDate: '2026-09-20',
        startTime: '10:00',
        endTime: '18:00',
        estimateMinutes: 480,
        assignee: null
      },
      -240 // UTC+4
    );
    expect(result.startTime).toBe('10:00');
    expect(result.endTime).toBe('18:00');
    expect(result.verified).toBe(true);
  });
});

describe('поиск и правка существующей задачи', () => {
  it('находит по номеру карточки, а не по id', async () => {
    const svc = makeService();
    const created = await svc.createTask({
      title: 'Задача с номером',
      dueDate: '2026-09-25',
      estimateMinutes: 60,
      assignee: null
    });

    const byNumber = await svc.findByNumber(`#${nextIndex}`);
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].id).toBe(created.taskId);
    expect(byNumber[0].id).not.toBe(nextIndex); // id и номер карточки различаются
  });

  it('меняет прогресс', async () => {
    const svc = makeService();
    const created = await svc.createTask({
      title: 'Задача',
      dueDate: '2026-09-25',
      estimateMinutes: 60,
      assignee: null
    });

    const updated = await svc.updateExistingTask(created.taskId, {
      title: '',
      dueDate: null,
      estimateMinutes: null,
      assignee: null,
      percentDone: 60
    });

    expect(updated.verified).toBe(true);
    expect(updated.percentDone).toBe(60);
  });

  it('меняет дату, оценку, приоритет и метки разом', async () => {
    const svc = makeService();
    const created = await svc.createTask({
      title: 'Задача',
      dueDate: '2026-09-25',
      estimateMinutes: 60,
      assignee: null
    });

    const updated = await svc.updateExistingTask(
      created.taskId,
      {
        title: '',
        dueDate: '2026-09-30',
        estimateMinutes: 240,
        assignee: null,
        priority: 5,
        labels: ['urgent'],
        endTime: '18:00'
      },
      -240
    );

    expect(updated.verified).toBe(true);
    expect(updated.dueDate).toBe('2026-09-30');
    expect(updated.estimateMinutes).toBe(240);
    expect(updated.endTime).toBe('18:00');
  });

  it('несуществующий номер не находится', async () => {
    const svc = makeService();
    expect(await svc.findByNumber('#999999')).toHaveLength(0);
  });
});

describe('доска', () => {
  it('группирует открытые задачи по колонкам', async () => {
    const svc = makeService();
    await svc.createTask({ title: 'Первая', dueDate: '2026-09-25', estimateMinutes: 60, assignee: null });
    await svc.createTask({ title: 'Вторая', dueDate: '2026-09-26', estimateMinutes: 60, assignee: null });

    const { groups, stats } = await svc.listBoard(50);
    expect(stats.open).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket.title).toBe('Дизайн');
    expect(groups[0].tasks).toHaveLength(2);
  });
});
