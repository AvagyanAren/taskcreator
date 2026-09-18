import { describe, expect, it } from 'vitest';
import {
  dayTimeToRFC3339,
  descriptionToHtml,
  formatEstimate,
  htmlToPlain,
  isoDayToRFC3339,
  parseDateInput,
  parseEstimate,
  parseEditCommand,
  parseTaskInput,
  splitTasks,
  rfc3339ToIsoDay,
  rfc3339ToLocalTime
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
      description: null,
      startDate: null,
      startTime: null,
      endTime: null,
      percentDone: null,
      labels: [],
      priority: null
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

  it('давно прошедшая дата без года переносится на следующий год', () => {
    // 1 марта прошло больше 90 дней назад -> имелся в виду 2027
    expect(parseDateInput('1 марта', NOW)).toBe('2027-03-01');
  });

  it('будущая дата остаётся в текущем году', () => {
    expect(parseDateInput('25 декабря', NOW)).toBe('2026-12-25');
  });

  it('недавно прошедшая дата остаётся в прошлом', () => {
    // задача, сделанная на прошлой неделе, должна уйти в "Выпущено",
    // а не переехать на год вперёд
    expect(parseDateInput('10 сентября', NOW)).toBe('2026-09-10');
    expect(parseDateInput('01.09', NOW)).toBe('2026-09-01');
    expect(parseDateInput('20 августа', NOW)).toBe('2026-08-20');
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
      description: null,
      startDate: null,
      startTime: null,
      endTime: null,
      percentDone: null,
      labels: [],
      priority: null
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

describe('время начала и конца', () => {
  it('«с 10:00 до 18:00»', () => {
    const r = parseTaskInput('Созвон по проекту, 20 сентября, с 10:00 до 18:00', NOW);
    expect(r.title).toBe('Созвон по проекту');
    expect(r.dueDate).toBe('2026-09-20');
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('18:00');
  });

  it('«10:00-18:30» без предлогов', () => {
    const r = parseTaskInput('Воркшоп, завтра, 10:00-18:30', NOW);
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('18:30');
    expect(r.title).toBe('Воркшоп');
  });

  it('одиночное время — это окончание', () => {
    const r = parseTaskInput('Ревью макетов, завтра, 14:00, 1h', NOW);
    expect(r.endTime).toBe('14:00');
    expect(r.startTime).toBeNull();
    expect(r.estimateMinutes).toBe(60);
    expect(r.title).toBe('Ревью макетов');
  });

  it('диапазон дат «с 18.09 по 25.09»', () => {
    const r = parseTaskInput('Спринт, с 18.09 по 25.09, 8h', NOW);
    expect(r.startDate).toBe('2026-09-18');
    expect(r.dueDate).toBe('2026-09-25');
    expect(r.title).toBe('Спринт');
  });

  it('время без даты означает сегодня', () => {
    const r = parseTaskInput('Созвон с 10:00 до 18:00', NOW);
    expect(r.title).toBe('Созвон');
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('18:00');
    // иначе время распозналось бы и молча потерялось при отправке
    expect(r.dueDate).toBe('2026-09-17');
  });

  it('без времени и без даты дата остаётся пустой', () => {
    expect(parseTaskInput('Просто задача', NOW).dueDate).toBeNull();
  });

  it('некорректное время игнорируется', () => {
    const r = parseTaskInput('Задача 99:99, завтра', NOW);
    expect(r.startTime).toBeNull();
    expect(r.endTime).toBeNull();
  });

  it('местное время переводится в UTC по смещению', () => {
    // UTC+4 -> getTimezoneOffset() === -240
    expect(dayTimeToRFC3339('2026-09-20', '10:00', -240)).toBe('2026-09-20T06:00:00.000Z');
    expect(dayTimeToRFC3339('2026-09-20', '18:00', -240)).toBe('2026-09-20T14:00:00.000Z');
    // и обратно
    expect(rfc3339ToLocalTime('2026-09-20T06:00:00.000Z', -240)).toBe('10:00');
  });

  it('без времени используется запасной час', () => {
    expect(dayTimeToRFC3339('2026-09-20', null, -240, 12)).toBe('2026-09-20T12:00:00.000Z');
  });

  it('полночь не уезжает на другой день', () => {
    expect(dayTimeToRFC3339('2026-09-20', '00:30', 0)).toBe('2026-09-20T00:30:00.000Z');
  });
});

describe('прогресс', () => {
  it('«50%»', () => {
    const r = parseTaskInput('Сделать мобильную версию Overview, 18.09.2026, 6h, 50%', NOW);
    expect(r.percentDone).toBe(50);
    expect(r.title).toBe('Сделать мобильную версию Overview');
    expect(r.estimateMinutes).toBe(360);
  });

  it('«прогресс 30%» и «готово на 100%»', () => {
    expect(parseTaskInput('Доделать PWA, 25 сентября, прогресс 30%', NOW).percentDone).toBe(30);
    expect(parseTaskInput('Встреча, 20.09, готово на 100%', NOW).percentDone).toBe(100);
  });

  it('progress 75% по-английски', () => {
    expect(parseTaskInput('Fix select, tomorrow, progress 75%', NOW).percentDone).toBe(75);
  });

  it('больше 100% не принимается', () => {
    expect(parseTaskInput('Задача, завтра, 150%', NOW).percentDone).toBeNull();
  });

  it('без процента — null', () => {
    expect(parseTaskInput('Задача, завтра, 2h', NOW).percentDone).toBeNull();
  });
});

describe('метки и приоритет', () => {
  it('метки #tag', () => {
    const r = parseTaskInput('Починить фильтры #багфикс #mobile, завтра, 2h', NOW);
    expect(r.labels).toEqual(['багфикс', 'mobile']);
    expect(r.title).toBe('Починить фильтры');
    expect(r.estimateMinutes).toBe(120);
  });

  it('приоритет словом и цифрой', () => {
    expect(parseTaskInput('Задача !важно, завтра', NOW).priority).toBe(3);
    expect(parseTaskInput('Задача !срочно, завтра', NOW).priority).toBe(4);
    expect(parseTaskInput('Задача !5, завтра', NOW).priority).toBe(5);
    expect(parseTaskInput('Задача !low, завтра', NOW).priority).toBe(1);
  });

  it('номер задачи не считается меткой', () => {
    const r = parseTaskInput('Доделать #249 по фидбеку, завтра, 1h', NOW);
    expect(r.labels).toEqual([]);
  });

  it('без меток и приоритета', () => {
    const r = parseTaskInput('Обычная задача, завтра, 1h', NOW);
    expect(r.labels).toEqual([]);
    expect(r.priority).toBeNull();
  });
});

describe('несколько задач за раз', () => {
  it('разделитель ---', () => {
    const blocks = splitTasks('Задача 1, завтра, 1h\n---\nЗадача 2, 20.09, 2h\nописание\n---\nЗадача 3, 25.09');
    expect(blocks).toHaveLength(3);
    expect(parseTaskInput(blocks[0], NOW).title).toBe('Задача 1');
    expect(parseTaskInput(blocks[1], NOW).description).toBe('описание');
    expect(parseTaskInput(blocks[2], NOW).title).toBe('Задача 3');
  });

  it('без разделителя — одна задача с описанием', () => {
    const blocks = splitTasks('Задача, завтра, 1h\nописание задачи');
    expect(blocks).toHaveLength(1);
  });

  it('пустой ввод', () => {
    expect(splitTasks('')).toEqual([]);
    expect(splitTasks('---')).toEqual([]);
  });
});

describe('правка существующей задачи', () => {
  it('«#249 прогресс 60%»', () => {
    const c = parseEditCommand('#249 прогресс 60%', NOW);
    expect(c?.number).toBe('249');
    expect(c?.patch.percentDone).toBe(60);
  });

  it('«249: 80%» — двоеточие тоже маркер', () => {
    expect(parseEditCommand('249: 80%', NOW)?.number).toBe('249');
  });

  it('«#249 на 25 сентября, 4h»', () => {
    const c = parseEditCommand('#249 на 25 сентября, 4h', NOW);
    expect(c?.patch.dueDate).toBe('2026-09-25');
    expect(c?.patch.estimateMinutes).toBe(240);
  });

  it('«#249 !срочно #важное»', () => {
    const c = parseEditCommand('#249 !срочно #важное', NOW);
    expect(c?.patch.priority).toBe(4);
    expect(c?.patch.labels).toEqual(['важное']);
  });

  it('«#249 с 10:00 до 12:00»', () => {
    const c = parseEditCommand('#249 с 10:00 до 12:00', NOW);
    expect(c?.patch.startTime).toBe('10:00');
    expect(c?.patch.endTime).toBe('12:00');
  });

  // Самое важное: обычная задача, начинающаяся с числа, не должна
  // случайно отредактировать чужую задачу.
  it('число в начале названия — это НЕ правка', () => {
    expect(parseEditCommand('2 задачи по адаптиву, завтра, 1h', NOW)).toBeNull();
    expect(parseEditCommand('3 страницы Business, 25 сентября, 4h', NOW)).toBeNull();
    expect(parseEditCommand('5 минут на проверку, завтра', NOW)).toBeNull();
    expect(parseEditCommand('2026 год планирования, завтра', NOW)).toBeNull();
  });

  it('номер без изменений — не правка', () => {
    expect(parseEditCommand('#249', NOW)).toBeNull();
    expect(parseEditCommand('#249 просто текст', NOW)).toBeNull();
  });

  it('обычная задача — не правка', () => {
    expect(parseEditCommand('Обычная задача, завтра, 2h', NOW)).toBeNull();
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
