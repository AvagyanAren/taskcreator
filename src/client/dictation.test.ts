import { describe, expect, it } from 'vitest';
import { applyTermDictionary, DEFAULT_TERMS } from './dictation.js';

describe('термины после распознавания речи', () => {
  it('英 термины возвращаются на латиницу', () => {
    expect(applyTermDictionary('сделать мобильную версию раздела овервью')).toBe(
      'сделать мобильную версию раздела Overview'
    );
  });

  it('фразы из двух слов', () => {
    expect(applyTermDictionary('доделать сайн ин и сайн ап')).toBe('доделать Sign in и Sign up');
    expect(applyTermDictionary('открыть пул реквест')).toBe('открыть pull request');
  });

  it('аббревиатуры', () => {
    expect(applyTermDictionary('доделать пи ви эй для профайла')).toBe('доделать PWA для Profile');
    expect(applyTermDictionary('починить апи')).toBe('починить API');
  });

  it('регистр не важен', () => {
    expect(applyTermDictionary('Овервью и ДЕПЛОЙ')).toBe('Overview и deploy');
  });

  it('русские слова не трогаются', () => {
    const text = 'сделать адаптивную версию страницы завтра за два часа';
    expect(applyTermDictionary(text)).toBe(text);
  });

  it('не режет слова, внутри которых встречается вариант', () => {
    // "апишка" не должно превратиться в "APIшка"
    expect(applyTermDictionary('апишка сломалась')).toBe('апишка сломалась');
  });

  it('смешанная фраза целиком', () => {
    expect(
      applyTermDictionary('доделать пи ви эй для раздела профайл и перейти к сайн ин сайн ап')
    ).toBe('доделать PWA для раздела Profile и перейти к Sign in Sign up');
  });

  it('свои термины можно добавить', () => {
    const custom = [{ term: 'Tamchys', heard: ['тамчис', 'там чис'] }];
    expect(applyTermDictionary('обновить там чис лендинг', [...DEFAULT_TERMS, ...custom])).toBe(
      'обновить Tamchys landing'
    );
  });

  it('пустая строка', () => {
    expect(applyTermDictionary('')).toBe('');
    expect(applyTermDictionary('   ')).toBe('   ');
  });
});
