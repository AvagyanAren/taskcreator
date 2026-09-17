import { describe, expect, it } from 'vitest';
import {
  descriptionToHtml,
  formatEstimate,
  htmlToPlain,
  isoDayToRFC3339,
  parseDateInput,
  parseEstimate,
  parseTaskInput,
  rfc3339ToIsoDay
} from './taskParser.js';

// Fixed "now" so the tests are deterministic: Wed 17 Sep 2026.
const NOW = new Date(2026, 8, 17, 10, 0, 0);

describe('parseTaskInput — примеры из ТЗ', () => {
  it('Сделать адаптивную версию Business, 25 сентября, 2h', () => {
    expect(parseTaskInput('Сделать адаптивную версию Business, 25 сентября, 2h', NOW)).toEqual({
      title: 'Сделать адаптивную версию Business',
      dueDate: '2026-09-25',
      estimateMinutes: 120,
      assignee: null,
      bucket: null,
      description: null
    });
  });

  it('Сделать mobile version Business, 25 сентября, 2h', () => {
    const r = parseTaskInput('Сделать mobile version Business, 25 сентября, 2h', NOW);
    expect(r.title).toBe('Сделать mobile version Business');
    expect(r.dueDate).toBe('2026-09-25');
    expect(r.estimateMinutes).toBe(120);
  });

  it('Сделать адаптив для Business до 25 сентября на 2 часа', () => {
    const r = parseTaskInput('Сделать адаптив для Business до 25 сентября на 2 часа', NOW);
    expect(r.title).toBe('Сделать адаптив для Business');
    expect(r.dueDate).toBe('2026-09-25');
    expect(r.estimateMinutes).toBe(120);
  });

  it('Проверить мобильную версию, 20.09, 1.5h', () => {
    const r = parseTaskInput('Проверить мобильную версию, 20.09, 1.5h', NOW);
    expect(r.title).toBe('Проверить мобильную версию');
    expect(r.dueDate).toBe('2026-09-20');
    expect(r.estimateMinutes).toBe(90);
  });

  it('Проверить мобильную версию платформы, дедлайн 20.09, 1.5 часа', () => {
    const r = parseTaskInput('Проверить мобильную версию платформы, дедлайн 20.09, 1.5 часа', NOW);
    expect(r.title).toBe('Проверить мобильную версию платформы');
    expect(r.dueDate).toBe('2026-09-20');
    expect(r.estimateMinutes).toBe(90);
  });

  it('Добавить advanced search, дедлайн 30 сентября, 4 часа', () => {
    const r = parseTaskInput('Добавить advanced search, дедлайн 30 сентября, 4 часа', NOW);
    expect(r.title).toBe('Добавить advanced search');
    expect(r.dueDate).toBe('2026-09-30');
    expect(r.estimateMinutes).toBe(240);
  });

  it('Fix mobile select, tomorrow, 30 min', () => {
    const r = parseTaskInput('Fix mobile select, tomorrow, 30 min', NOW);
    expect(r.title).toBe('Fix mobile select');
    expect(r.dueDate).toBe('2026-09-18');
    expect(r.estimateMinutes).toBe(30);
  });

  it('Редизайн страницы Business - 25 сентября - 2h', () => {
    const r = parseTaskInput('Редизайн страницы Business - 25 сентября - 2h', NOW);
    expect(r.title).toBe('Редизайн страницы Business');
    expect(r.dueDate).toBe('2026-09-25');
    expect(r.estimateMinutes).toBe(120);
  });
});

describe('даты', () => {
  const cases: Array<[string, string]> = [
    ['сегодня', '2026-09-17'],
    ['today', '2026-09-17'],
    ['завтра', '2026-09-18'],
    ['tomorrow', '2026-09-18'],
    ['послезавтра', '2026-09-19'],
    ['20.09', '2026-09-20'],
    ['20.09.2026', '2026-09-20'],
    ['20/09/26', '2026-09-20'],
    ['25 сентября', '2026-09-25'],
    ['25 сентября 2026', '2026-09-25'],
    ['2026-09-25', '2026-09-25'],
    ['25 September 2026', '2026-09-25'],
    ['September 25', '2026-09-25'],
    ['next Monday', '2026-09-21'],
    ['следующий понедельник', '2026-09-21']
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected}`, () => {
      expect(parseDateInput(input, NOW)).toBe(expected);
    });
  }

  it('без года берёт ближайшую будущую дату', () => {
    // 1 марта уже прошло в текущем 2026 -> переносим на 2027
    expect(parseDateInput('1 марта', NOW)).toBe('2027-03-01');
    // 25 декабря ещё впереди -> остаётся в 2026
    expect(parseDateInput('25 декабря', NOW)).toBe('2026-12-25');
  });

  it('несуществующая дата не распознаётся', () => {
    expect(parseDateInput('31 февраля', NOW)).toBeNull();
    expect(parseDateInput('просто текст', NOW)).toBeNull();
  });
});

describe('estimate', () => {
  const cases: Array<[string, number]> = [
    ['5m', 5],
    ['15m', 15],
    ['30m', 30],
    ['45m', 45],
    ['1h', 60],
    ['1h 30m', 90],
    ['2h', 120],
    ['3h', 180],
    ['4h', 240],
    ['6h', 360],
    ['8h', 480],
    ['90m', 90],
    ['150m', 150],
    ['1.5h', 90],
    ['2.5h', 150],
    ['2,5h', 150],
    ['30 мин', 30],
    ['2 часа', 120],
    ['1 час', 60],
    ['45', 45]
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected} мин`, () => {
      expect(parseEstimate(input)).toBe(expected);
    });
  }

  it('пустое значение', () => {
    expect(parseEstimate('')).toBeNull();
    expect(parseEstimate('без оценки')).toBeNull();
  });

  it('formatEstimate', () => {
    expect(formatEstimate(120)).toBe('2h');
    expect(formatEstimate(90)).toBe('1h 30m');
    expect(formatEstimate(30)).toBe('30m');
    expect(formatEstimate(null)).toBe('—');
  });
});

describe('assignee', () => {
  it('assign Aren', () => {
    const r = parseTaskInput('Сделать адаптив Business, 25 сентября, 2h, assign Aren', NOW);
    expect(r.assignee).toBe('Aren');
    expect(r.title).toBe('Сделать адаптив Business');
    expect(r.estimateMinutes).toBe(120);
  });

  it('@aren', () => {
    const r = parseTaskInput('Сделать адаптив Business, 25 сентября, 2h, @aren', NOW);
    expect(r.assignee).toBe('aren');
    expect(r.title).toBe('Сделать адаптив Business');
  });

  it('исполнитель Арен Авагян — имя из двух слов', () => {
    const r = parseTaskInput('Доделать PWA для Profile, 17 сентября, 6ч, исполнитель Арен Авагян', NOW);
    expect(r.assignee).toBe('Арен Авагян');
    expect(r.title).toBe('Доделать PWA для Profile');
    expect(r.dueDate).toBe('2026-09-17');
    expect(r.estimateMinutes).toBe(360);
  });

  it('assign Aren Avagyan', () => {
    const r = parseTaskInput('Fix profile page, tomorrow, 2h, assign Aren Avagyan', NOW);
    expect(r.assignee).toBe('Aren Avagyan');
    expect(r.title).toBe('Fix profile page');
  });

  it('по умолчанию null', () => {
    expect(parseTaskInput('Просто задача', NOW).assignee).toBeNull();
  });
});

describe('description', () => {
  it('со второй строки', () => {
    const r = parseTaskInput(
      'Доделать PWA для Profile, 25 сентября, 2h\nНужно проверить offline-режим\nи иконки',
      NOW
    );
    expect(r.title).toBe('Доделать PWA для Profile');
    expect(r.dueDate).toBe('2026-09-25');
    expect(r.estimateMinutes).toBe(120);
    expect(r.description).toBe('Нужно проверить offline-режим\nи иконки');
  });

  it('по ключевому слову «описание:»', () => {
    const r = parseTaskInput(
      'Починить фильтры, завтра, 30m, описание: не работает сброс на мобильных',
      NOW
    );
    expect(r.title).toBe('Починить фильтры');
    expect(r.estimateMinutes).toBe(30);
    expect(r.description).toBe('не работает сброс на мобильных');
  });

  it('description: тоже работает', () => {
    const r = parseTaskInput('Fix select, tomorrow, 1h, description: broken on iOS', NOW);
    expect(r.title).toBe('Fix select');
    expect(r.description).toBe('broken on iOS');
  });

  it('без описания — null', () => {
    expect(parseTaskInput('Просто задача, завтра, 1h', NOW).description).toBeNull();
  });

  it('HTML-конвертация и обратное чтение', () => {
    const text = 'Первый абзац\nвторая строка\n\nВторой абзац';
    const html = descriptionToHtml(text);
    expect(html).toContain('<p>');
    expect(html).toContain('<br>');
    expect(htmlToPlain(html)).toBe(text);
  });

  it('экранирование HTML', () => {
    expect(descriptionToHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });
});

describe('устойчивость', () => {
  it('только название', () => {
    expect(parseTaskInput('Починить фильтры', NOW)).toEqual({
      title: 'Починить фильтры',
      dueDate: null,
      estimateMinutes: null,
      assignee: null,
      bucket: null,
      description: null
    });
  });

  it('пустая строка', () => {
    expect(parseTaskInput('', NOW).title).toBe('');
  });

  it('не съедает цифры из названия', () => {
    const r = parseTaskInput('Обновить API v2 endpoint', NOW);
    expect(r.title).toBe('Обновить API v2 endpoint');
    expect(r.estimateMinutes).toBeNull();
  });
});

describe('RFC3339 helpers', () => {
  it('день -> timestamp -> день', () => {
    const ts = isoDayToRFC3339('2026-09-25');
    expect(ts).toBe('2026-09-25T12:00:00.000Z');
    expect(rfc3339ToIsoDay(ts)).toBe('2026-09-25');
  });

  it('час можно задать (start date раньше end date)', () => {
    expect(isoDayToRFC3339('2026-09-25', 6)).toBe('2026-09-25T06:00:00.000Z');
    expect(rfc3339ToIsoDay(isoDayToRFC3339('2026-09-25', 6))).toBe('2026-09-25');
  });

  it('нулевая дата Vikunja', () => {
    expect(rfc3339ToIsoDay('0001-01-01T00:00:00Z')).toBeNull();
    expect(rfc3339ToIsoDay(undefined)).toBeNull();
  });
});
