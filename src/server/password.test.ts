import { describe, expect, it } from 'vitest';
import { passwordMatches } from './password.js';

describe('проверка пароля', () => {
  it('кириллический пароль приходит в percent-encoding', () => {
    const password = 'Пароль123';
    expect(passwordMatches(password, encodeURIComponent(password))).toBe(true);
  });

  it('латинский пароль работает и без кодирования', () => {
    expect(passwordMatches('secret123', 'secret123')).toBe(true);
    expect(passwordMatches('secret123', encodeURIComponent('secret123'))).toBe(true);
  });

  it('спецсимволы и пробелы', () => {
    const password = 'a b&c=d+e%f';
    expect(passwordMatches(password, encodeURIComponent(password))).toBe(true);
  });

  it('эмодзи', () => {
    const password = 'пароль🔒';
    expect(passwordMatches(password, encodeURIComponent(password))).toBe(true);
  });

  it('неверный пароль отклоняется', () => {
    expect(passwordMatches('secret', 'wrong')).toBe(false);
    expect(passwordMatches('Пароль', encodeURIComponent('Другой'))).toBe(false);
  });

  it('пустой пароль в конфиге = защита выключена', () => {
    expect(passwordMatches('', '')).toBe(true);
  });

  it('пустой присланный пароль отклоняется', () => {
    expect(passwordMatches('secret', '')).toBe(false);
  });

  it('битая кодировка не роняет сервер', () => {
    expect(passwordMatches('secret', '%E0%A4%A')).toBe(false);
  });
});
