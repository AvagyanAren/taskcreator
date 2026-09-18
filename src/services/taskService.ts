import { EdgeFocusClient, EdgeFocusError } from '../api/edgefocus.js';
import { cached, TTL } from './cache.js';
import {
  dayTimeToRFC3339,
  descriptionToHtml,
  formatEstimate,
  htmlToPlain,
  rfc3339ToIsoDay,
  rfc3339ToLocalTime
} from '../parser/taskParser.js';
import type {
  CreatedTaskResult,
  EFBucket,
  EFTask,
  EFUser,
  MovedTaskResult,
  ParsedTask,
  VerificationCheck
} from '../types/edgefocus.js';

export interface DuplicateCandidate {
  taskId: number;
  title: string;
  dueDate: string | null;
  created: string | null;
  url: string;
}

export class TaskService {
  constructor(private readonly client: EdgeFocusClient) {}

  private get cfg() {
    return this.client.config;
  }

  taskUrl(taskId: number): string {
    return `${this.cfg.webUrl}/tasks/${taskId}`;
  }

  /** All Kanban columns of the configured view (cached — they rarely change). */
  listBuckets(): Promise<EFBucket[]> {
    return cached(`buckets:${this.cfg.projectId}:${this.cfg.kanbanViewId}`, TTL.buckets, () =>
      this.client.getBuckets()
    );
  }

  /** The Kanban view itself, for done_bucket_id (cached). */
  private getView() {
    return cached(`view:${this.cfg.projectId}:${this.cfg.kanbanViewId}`, TTL.view, () =>
      this.client.getView()
    );
  }

  /** Resolves the target bucket by NAME — the id is never hardcoded. */
  async resolveTargetBucket(name = this.cfg.targetBucket): Promise<EFBucket> {
    const buckets = await this.listBuckets();
    const wanted = name.trim().toLowerCase();
    const found = buckets.find((b) => (b.title ?? '').trim().toLowerCase() === wanted);
    if (!found) {
      const list = buckets.map((b) => `"${b.title}" (id ${b.id})`).join(', ') || '(none)';
      throw new EdgeFocusError(
        'not_found',
        `Bucket "${name}" not found in view ${this.cfg.kanbanViewId}. Available buckets: ${list}`,
        undefined,
        `GET /projects/${this.cfg.projectId}/views/${this.cfg.kanbanViewId}/buckets returned ${buckets.length} buckets.`
      );
    }
    return found;
  }


  /**
   * Reads the task's real column. `bucket_id` is only filled in "when the task
   * is accessed via a view with buckets" and often comes back as 0, so we ask
   * for `expand=buckets`, which lists every bucket the task belongs to.
   */
  async readTaskBucket(taskId: number): Promise<EFBucket | null> {
    const task = await this.client.getTask(taskId, 'buckets').catch(() => null);
    const buckets = Array.isArray(task?.buckets) ? task!.buckets! : [];
    const inView = buckets.find((b) => b.project_view_id === this.cfg.kanbanViewId);
    if (inView) return inView;
    if (buckets.length > 0) return buckets[0];
    const id = task?.bucket_id;
    if (id) {
      const all = await this.listBuckets().catch(() => []);
      return all.find((b) => b.id === id) ?? null;
    }
    return null;
  }

  /**
   * Puts a task into a column and confirms it landed there. The documented
   * bucket endpoint is tried first; `models.Task.bucket_id` ("Can be used to
   * move a task between buckets") is the fallback.
   */
  async placeInBucket(taskId: number, bucket: EFBucket): Promise<{ ok: boolean; error: string | null; actual: EFBucket | null }> {
    let error: string | null = null;
    try {
      await this.client.moveTaskToBucket(taskId, bucket.id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    let actual = await this.readTaskBucket(taskId);
    if (actual?.id === bucket.id) return { ok: true, error: null, actual };

    try {
      await this.client.updateTask(taskId, { bucket_id: bucket.id });
      actual = await this.readTaskBucket(taskId);
      if (actual?.id === bucket.id) return { ok: true, error: null, actual };
    } catch (err) {
      error = error ?? (err instanceof Error ? err.message : String(err));
    }

    return { ok: false, error, actual };
  }

  /** Duplicate guard: look for a task with the same title created recently. */
  async findPossibleDuplicates(title: string): Promise<DuplicateCandidate[]> {
    const normalized = title.trim().toLowerCase();
    if (!normalized) return [];
    let tasks: EFTask[] = [];
    try {
      tasks = await this.client.getViewTasks({ s: title, perPage: 50 });
    } catch {
      return []; // the guard must never block task creation on its own
    }
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 3;
    return tasks
      .filter((t) => (t.title ?? '').trim().toLowerCase() === normalized)
      .filter((t) => {
        if (!t.created) return true;
        const ts = new Date(t.created).getTime();
        return Number.isNaN(ts) ? true : ts >= cutoff;
      })
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        dueDate: rfc3339ToIsoDay(t.end_date),
        created: t.created ?? null,
        url: this.taskUrl(t.id)
      }));
  }

  /**
   * Auto-routing rule: a task whose end date is already in the past is finished
   * work, so it goes straight to the "done" column (EDGEFOCUS_DONE_BUCKET).
   * The API marks such a task as done automatically when that column is the
   * view's done_bucket_id.
   */
  isPastDate(day: string | null, now = new Date()): boolean {
    if (!day) return false;
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) return false;
    const target = new Date(y, m - 1, d).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return target < today;
  }

  /** Decides which column a new task belongs to. Explicit choice always wins. */
  async decideBucket(parsed: ParsedTask, now = new Date()) {
    if (parsed.bucket) {
      return { bucket: await this.resolveTargetBucket(parsed.bucket), auto: false as const };
    }
    if (this.cfg.doneBucket && this.isPastDate(parsed.dueDate, now)) {
      return { bucket: await this.resolveTargetBucket(this.cfg.doneBucket), auto: true as const };
    }
    return { bucket: await this.resolveTargetBucket(), auto: false as const };
  }

  /**
   * Current board contents, grouped by column.
   *
   * Two shapes have to be handled. A kanban view answers
   * `/views/{view}/tasks` with the *buckets*, each carrying its own `tasks`
   * array — so the grouping comes for free. A list/table view answers with a
   * flat task array, and then the column has to be worked out per task:
   * `bucket_id` is only filled "when the task is accessed via a view with
   * buckets" and is often 0, so `expand=buckets` is used as the fallback.
   */
  async listBoard(
    limit = 50
  ): Promise<{
    groups: Array<{ bucket: EFBucket; tasks: EFTask[] }>;
    stats: { received: number; open: number; resolved: number; source: string };
  }> {
    const buckets = await this.listBuckets();
    const byId = new Map<number, EFBucket>(buckets.map((b) => [b.id, b]));
    const isOpen = (t: EFTask) => t && !t.done;

    // --- shape 1: the kanban view returns buckets with nested tasks ---
    const raw = (await this.client.getViewTasks({
      viewId: this.cfg.kanbanViewId,
      perPage: limit,
      expand: 'buckets'
    })) as unknown as Array<Partial<EFBucket & EFTask> & { tasks?: EFTask[] }>;

    const looksLikeBuckets =
      raw.length > 0 &&
      raw.every((item) => item && item.project_id === undefined && item.title !== undefined) &&
      raw.some((item) => Array.isArray(item.tasks) || byId.has(Number(item.id)));

    if (looksLikeBuckets) {
      const groups = raw
        .map((item) => {
          const bucket = byId.get(Number(item.id)) ?? ({ id: Number(item.id), title: String(item.title) } as EFBucket);
          const tasks = (Array.isArray(item.tasks) ? item.tasks : []).filter(isOpen);
          return { bucket, tasks };
        })
        .filter((group) => group.tasks.length > 0);

      const total = groups.reduce((n, g) => n + g.tasks.length, 0);
      if (total > 0) {
        return {
          groups,
          stats: { received: raw.length, open: total, resolved: total, source: 'kanban' }
        };
      }
      // Buckets came back without their tasks — fall through to the flat list.
    }

    // --- shape 2: a flat task list (table view), column resolved per task ---
    const flat = looksLikeBuckets
      ? await this.client.getViewTasks({ viewId: this.cfg.tableViewId, perPage: limit })
      : (raw as unknown as EFTask[]);

    const open = flat.filter(isOpen);

    const columnOf = (task: EFTask): EFBucket | null => {
      const own = Array.isArray(task.buckets) ? task.buckets : [];
      const inView =
        own.find((b) => b.project_view_id === this.cfg.kanbanViewId) ?? own[0] ?? null;
      if (inView?.id && byId.has(inView.id)) return byId.get(inView.id)!;
      if (task.bucket_id && byId.has(task.bucket_id)) return byId.get(task.bucket_id)!;
      return null;
    };

    const placed = new Map<number, { task: EFTask; bucket: EFBucket }>();
    for (const task of open) {
      const bucket = columnOf(task);
      if (bucket) placed.set(task.id, { task, bucket });
    }

    let source = looksLikeBuckets ? 'table' : 'list';
    const unresolved = open.filter((t) => !placed.has(t.id));
    if (unresolved.length > 0) {
      source += '+lookup';
      const details = await Promise.all(
        unresolved.slice(0, 25).map((t) =>
          this.client
            .getTask(t.id, 'buckets')
            .then((full) => ({ task: t, full }))
            .catch(() => null)
        )
      );
      for (const entry of details) {
        if (!entry?.full) continue;
        const bucket = columnOf({ ...entry.task, ...entry.full });
        if (bucket) placed.set(entry.task.id, { task: entry.task, bucket });
      }
    }

    const byBucket = new Map<number, EFTask[]>();
    for (const { task, bucket } of placed.values()) {
      const list = byBucket.get(bucket.id) ?? [];
      list.push(task);
      byBucket.set(bucket.id, list);
    }

    const groups = buckets
      .map((bucket) => ({ bucket, tasks: byBucket.get(bucket.id) ?? [] }))
      .filter((group) => group.tasks.length > 0);

    return {
      groups,
      stats: { received: flat.length, open: open.length, resolved: placed.size, source }
    };
  }

  /** Finds a task by numeric id or by (partial) title inside the project. */
  async findTask(query: string): Promise<EFTask[]> {
    const q = query.trim().replace(/^#/, '');
    if (/^\d+$/.test(q)) {
      const task = await this.client.getTask(Number(q));
      return task?.project_id === this.cfg.projectId ? [task] : [];
    }
    const tasks = await this.client.getViewTasks({ s: q, perPage: 25 });
    const lower = q.toLowerCase();
    return tasks.filter((t) => (t.title ?? '').toLowerCase().includes(lower)).slice(0, 10);
  }

  /**
   * Moves an already existing task into a column, regardless of its dates.
   * Defaults to the configured "done" column.
   */
  async moveTask(taskId: number, bucketTitle?: string): Promise<MovedTaskResult> {
    const target = await this.resolveTargetBucket(bucketTitle || this.cfg.doneBucket || undefined);
    const placement = await this.placeInBucket(taskId, target);
    const fresh = await this.client.getTask(taskId);

    const view = await this.getView().catch(() => null);
    const isDoneColumn = view?.done_bucket_id === target.id;

    const checks: VerificationCheck[] = [
      {
        field: 'Bucket',
        expected: target.title,
        actual: placement.actual
          ? placement.actual.title
          : placement.error
            ? `не удалось: ${placement.error}`
            : 'колонка не определена',
        ok: placement.ok
      }
    ];
    if (isDoneColumn) {
      checks.push({
        field: 'Done',
        expected: 'true',
        actual: String(Boolean(fresh.done)),
        ok: Boolean(fresh.done)
      });
    }

    return {
      taskId,
      title: fresh.title ?? '',
      bucket: target.title,
      done: Boolean(fresh.done),
      url: this.taskUrl(taskId),
      verification: checks,
      verified: checks.every((c) => c.ok)
    };
  }

  /** Reads assignees from both places the API exposes them. */
  async readAssignees(taskId: number): Promise<EFUser[]> {
    const seen = new Map<number, EFUser>();
    const add = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const u of list as EFUser[]) if (u?.id && !seen.has(u.id)) seen.set(u.id, u);
    };
    add(await this.client.getAssignees(taskId).catch(() => []));
    const task = await this.client.getTask(taskId).catch(() => null);
    add(task?.assignees);
    return [...seen.values()];
  }

  /**
   * Assigns a person, trying every documented route in turn and verifying
   * after each one: PUT /assignees, then POST /assignees/bulk, then
   * POST /tasks/{id} with the `assignees` field of models.Task.
   */
  async assignUser(taskId: number, user: EFUser): Promise<{ ok: boolean; via: string | null; error: string | null }> {
    const has = async () => (await this.readAssignees(taskId)).some((u) => u.id === user.id);
    let error: string | null = null;

    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['PUT /assignees', () => this.client.addAssignee(taskId, user.id)],
      ['POST /assignees/bulk', () => this.client.addAssigneesBulk(taskId, [user])],
      ['POST /tasks/{id}', () => this.client.updateTask(taskId, { assignees: [user] })]
    ];

    for (const [via, call] of attempts) {
      try {
        await call();
      } catch (err) {
        error = error ?? (err instanceof Error ? err.message : String(err));
        continue;
      }
      if (await has()) return { ok: true, via, error: null };
    }
    return { ok: false, via: null, error };
  }

  /**
   * `percent_done` is documented only as "determines how far a task is left
   * from being done", without a scale. EdgeFocus stores it as a fraction
   * (0.5 = 50%), but rather than trust that, we write the fraction, read the
   * task back and retry with whole percents if the value did not stick.
   */
  static toPercentDisplay(raw: number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    if (!Number.isFinite(raw)) return null;
    return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  }

  async applyProgress(taskId: number, percent: number): Promise<boolean> {
    const matches = async () => {
      const fresh = await this.client.getTask(taskId).catch(() => null);
      return TaskService.toPercentDisplay(fresh?.percent_done ?? null) === Math.round(percent);
    };
    if (await matches()) return true;
    try {
      await this.client.updateTask(taskId, { percent_done: percent });
    } catch {
      return false;
    }
    return matches();
  }

  /** Collects assignee candidates without ever throwing. */
  private async candidateUsers(query: string): Promise<EFUser[]> {
    const seen = new Map<number, EFUser>();
    const add = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const u of list as EFUser[]) if (u?.id && !seen.has(u.id)) seen.set(u.id, u);
    };
    const tryCall = async (fn: () => Promise<EFUser[]>) => {
      try {
        add(await fn());
      } catch {
        /* permissions or network — just skip this source */
      }
    };

    const words = query.split(/\s+/).filter(Boolean);
    // Whole string, then each word on its own ("Арен Авагян" may not match as
    // one query), then the full member list as a last resort.
    await tryCall(() => this.client.searchProjectUsers(query));
    for (const w of words) await tryCall(() => this.client.searchProjectUsers(w));
    await tryCall(() => this.client.searchProjectUsers(''));
    if (seen.size === 0) {
      await tryCall(() => this.client.searchUsers(query));
      for (const w of words) await tryCall(() => this.client.searchUsers(w));
    }
    return [...seen.values()];
  }

  /**
   * Resolves a person by username, full name, or name words in any order
   * ("Арен Авагян" vs "Авагян Арен"). Returns the candidate list too, so the
   * error message can show what the project actually contains.
   */
  async resolveAssignee(query: string): Promise<EFUser | null> {
    const { user } = await this.resolveAssigneeDetailed(query);
    return user;
  }

  async resolveAssigneeDetailed(query: string): Promise<{ user: EFUser | null; candidates: EFUser[] }> {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return { user: null, candidates: [] };

    // The lookup fans out over several endpoints, so the result is cached.
    const users = await cached(`users:${this.cfg.projectId}:${q}`, TTL.user, () =>
      this.candidateUsers(q)
    );
    const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);

    const user =
      users.find((u) => norm(u.username) === q) ??
      users.find((u) => norm(u.name) === q) ??
      users.find((u) => {
        const nameWords = norm(u.name).split(/\s+/).filter(Boolean);
        return (
          words.length > 1 &&
          nameWords.length > 1 &&
          words.every((w) => nameWords.includes(w))
        );
      }) ??
      users.find((u) => norm(u.name).includes(q) || norm(u.username).includes(q)) ??
      // single distinctive word, e.g. just a surname
      users.find((u) => {
        const hay = `${norm(u.name)} ${norm(u.username)}`;
        return words.some((w) => w.length >= 3 && hay.includes(w));
      }) ??
      null;

    return { user, candidates: users };
  }

  /**
   * Full pipeline: create -> move to bucket -> (optional) assign -> verify.
   */
  async createTask(parsed: ParsedTask, tzOffsetMinutes = 0): Promise<CreatedTaskResult> {
    const title = parsed.title.trim();
    if (!title) throw new EdgeFocusError('validation', 'Task title is empty.');

    const { bucket } = await this.decideBucket(parsed);

    // 1. Create — PUT /projects/{id}/tasks with models.Task
    const payload: Record<string, unknown> = { title, project_id: this.cfg.projectId };
    const description = (parsed.description ?? '').trim();
    if (description) payload.description = descriptionToHtml(description);
    const startDay = parsed.startDate || parsed.dueDate;
    if (parsed.dueDate) {
      payload.end_date = dayTimeToRFC3339(parsed.dueDate, parsed.endTime, tzOffsetMinutes, 12);
      // EdgeFocus shows a task on the board/Gantt only when it has both ends,
      // so the start date defaults to the same day unless disabled.
      if (this.cfg.setStartDate && startDay) {
        payload.start_date = dayTimeToRFC3339(startDay, parsed.startTime, tzOffsetMinutes, 6);
      }
    }
    if (parsed.percentDone !== null && parsed.percentDone !== undefined) {
      // Written as a fraction first; applyProgress() fixes the scale if needed.
      payload.percent_done = parsed.percentDone / 100;
    }
    if (parsed.estimateMinutes) payload.time_estimate = parsed.estimateMinutes;
    const created = await this.client.createTask(payload as never);

    if (!created?.id) {
      throw new EdgeFocusError(
        'unknown',
        'EdgeFocus did not return a task id after creation.',
        undefined,
        JSON.stringify(created).slice(0, 500)
      );
    }

    // 2. Move into the Kanban bucket — POST .../buckets/{bucket}/tasks (models.TaskBucket)
    const placement = await this.placeInBucket(created.id, bucket);

    // 3. Optional assignee — PUT /tasks/{taskID}/assignees (models.TaskAssginee)
    let assigneeError: string | null = null;
    let expectedAssignee: string | null = null;
    const wantedAssignee = parsed.assignee || this.cfg.defaultAssignee || null;
    if (wantedAssignee) {
      try {
        const { user, candidates } = await this.resolveAssigneeDetailed(wantedAssignee);
        if (!user) {
          const known = candidates
            .map((u) => `${u.name || '—'} (@${u.username})`)
            .slice(0, 10)
            .join(', ');
          assigneeError =
            `Пользователь "${wantedAssignee}" не найден. ` +
            (known ? `Доступные участники: ${known}` : 'Список участников пуст — возможно, у токена нет прав на Projects: Projectusers.');
        } else {
          expectedAssignee = user.username;
          const applied = await this.assignUser(created.id, user);
          if (!applied.ok) {
            assigneeError =
              applied.error ??
              'EdgeFocus принял запрос, но исполнитель не сохранился (ни одним из трёх способов).';
          }
        }
      } catch (err) {
        assigneeError = err instanceof Error ? err.message : String(err);
      }
    }

    // 3b. Progress, with scale detection
    let progressError: string | null = null;
    if (parsed.percentDone !== null && parsed.percentDone !== undefined) {
      const ok = await this.applyProgress(created.id, parsed.percentDone);
      if (!ok) progressError = 'значение не сохранилось';
    }

    // 4. Verify by re-reading the task
    const fresh = await this.client.getTask(created.id);
    const actualDay = rfc3339ToIsoDay(fresh.end_date);
    const actualStartDay = rfc3339ToIsoDay(fresh.start_date);
    const actualStartTime = rfc3339ToLocalTime(fresh.start_date, tzOffsetMinutes);
    const actualEndTime = rfc3339ToLocalTime(fresh.end_date, tzOffsetMinutes);
    const actualPercent = TaskService.toPercentDisplay(fresh.percent_done ?? null);
    const assignees = (await this.readAssignees(created.id)).map((u) => u.username);

    const checks: VerificationCheck[] = [
      { field: 'Title', expected: title, actual: fresh.title ?? '', ok: (fresh.title ?? '') === title },
      ...(description
        ? [
            {
              field: 'Description',
              expected: description,
              actual: htmlToPlain(fresh.description),
              ok: htmlToPlain(fresh.description) === htmlToPlain(descriptionToHtml(description))
            }
          ]
        : []),
      {
        field: 'Project',
        expected: String(this.cfg.projectId),
        actual: String(fresh.project_id ?? ''),
        ok: fresh.project_id === this.cfg.projectId
      },
      {
        field: 'Date',
        expected: parsed.dueDate ?? '—',
        actual: actualDay ?? '—',
        ok: parsed.dueDate ? actualDay === parsed.dueDate : true
      },
      {
        field: 'Estimate',
        expected: formatEstimate(parsed.estimateMinutes),
        actual: formatEstimate(fresh.time_estimate ?? null),
        ok: parsed.estimateMinutes
          ? (fresh.time_estimate ?? 0) === parsed.estimateMinutes
          : true
      },
      {
        field: 'Bucket',
        expected: bucket.title,
        actual: placement.actual
          ? placement.actual.title
          : placement.error
            ? `не удалось: ${placement.error}`
            : 'колонка не определена',
        ok: placement.ok
      }
    ];

    if (this.cfg.setStartDate && startDay) {
      checks.splice(3, 0, {
        field: 'Start date',
        expected: startDay,
        actual: actualStartDay ?? '—',
        ok: actualStartDay === startDay
      });
    }

    if (parsed.startTime) {
      checks.push({
        field: 'Начало',
        expected: parsed.startTime,
        actual: actualStartTime ?? '—',
        ok: actualStartTime === parsed.startTime
      });
    }
    if (parsed.endTime) {
      checks.push({
        field: 'Окончание',
        expected: parsed.endTime,
        actual: actualEndTime ?? '—',
        ok: actualEndTime === parsed.endTime
      });
    }
    if (parsed.percentDone !== null && parsed.percentDone !== undefined) {
      checks.push({
        field: 'Прогресс',
        expected: `${parsed.percentDone}%`,
        actual: progressError
          ? `не удалось: ${progressError}`
          : actualPercent !== null
            ? `${actualPercent}%`
            : '—',
        ok: !progressError && actualPercent === Math.round(parsed.percentDone)
      });
    }

    if (wantedAssignee) {
      checks.push({
        field: 'Assignee',
        expected: expectedAssignee ?? wantedAssignee,
        actual: assigneeError ? `failed: ${assigneeError}` : assignees.join(', ') || '—',
        ok:
          !assigneeError &&
          !!expectedAssignee &&
          assignees.map((a) => a.toLowerCase()).includes(expectedAssignee.toLowerCase())
      });
    }

    const result: CreatedTaskResult = {
      taskId: created.id,
      title: fresh.title ?? title,
      dueDate: actualDay,
      startDate: actualStartDay,
      startTime: actualStartTime,
      endTime: actualEndTime,
      percentDone: actualPercent,
      estimateMinutes: fresh.time_estimate ?? null,
      bucket: bucket.title,
      assignees,
      url: this.taskUrl(created.id),
      verification: checks,
      verified: checks.every((c) => c.ok)
    };

    return result;
  }
}
