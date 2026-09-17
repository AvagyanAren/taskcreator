import { describe, expect, it } from 'vitest';
import { TaskService } from './taskService.js';

/** decideBucket/isPastDate need no network, so a bare instance is enough. */
const svc = new TaskService({ config: {} } as never);
const NOW = new Date(2026, 8, 17); // 17 Sep 2026

describe('правило «прошедшая дата → done-колонка»', () => {
  it('вчерашняя дата считается прошедшей', () => {
    expect(svc.isPastDate('2026-09-16', NOW)).toBe(true);
  });

  it('сегодня — не прошедшая', () => {
    expect(svc.isPastDate('2026-09-17', NOW)).toBe(false);
  });

  it('будущая дата — не прошедшая', () => {
    expect(svc.isPastDate('2026-09-25', NOW)).toBe(false);
  });

  it('прошлый год', () => {
    expect(svc.isPastDate('2025-12-31', NOW)).toBe(true);
  });

  it('без даты правило не срабатывает', () => {
    expect(svc.isPastDate(null, NOW)).toBe(false);
    expect(svc.isPastDate('', NOW)).toBe(false);
    expect(svc.isPastDate('мусор', NOW)).toBe(false);
  });
});
