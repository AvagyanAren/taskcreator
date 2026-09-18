import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeech } from './useSpeech.js';

/** Stand-in engine that reproduces real phone behaviour. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  static throwOnStart = false;
  /** When true, stop() delivers nothing — as some mobile engines do. */
  static silentStop = false;

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  aborted = false;
  stopped = false;

  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error('already started');
  }
  stop() {
    this.stopped = true;
    if (!FakeRecognition.silentStop) this.onend?.();
  }
  abort() {
    this.aborted = true;
  }

  /** Emits a chunk the way the browser does: interim first, then final. */
  emit(chunks: Array<{ transcript: string; isFinal: boolean }>) {
    const results = chunks.map((c) => {
      const entry = [{ transcript: c.transcript }] as ArrayLike<{ transcript: string }> & {
        isFinal?: boolean;
      };
      (entry as { isFinal?: boolean }).isFinal = c.isFinal;
      return entry;
    });
    this.onresult?.({ results });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.last = null;
  FakeRecognition.throwOnStart = false;
  FakeRecognition.silentStop = false;
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition;
});

describe('голосовой ввод', () => {
  it('русский язык и непрерывный режим', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    expect(FakeRecognition.last!.lang).toBe('ru-RU');
    expect(FakeRecognition.last!.continuous).toBe(true);
    expect(FakeRecognition.last!.interimResults).toBe(true);
  });

  it('финальный результат попадает в поле', () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech(onText));
    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.emit([{ transcript: 'Сделать адаптив, завтра, 2 часа', isFinal: true }]));
    act(() => result.current.stop());
    act(() => void vi.advanceTimersByTime(2000));

    expect(onText).toHaveBeenCalledWith('Сделать адаптив, завтра, 2 часа');
    expect(result.current.listening).toBe(false);
  });

  // Это и был баг: abort() выбрасывал распознанное, поле оставалось пустым.
  it('текст не теряется, даже если движок ничего не отдаёт по stop()', () => {
    FakeRecognition.silentStop = true;
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech(onText));

    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.emit([{ transcript: 'Проверить мобильную версию', isFinal: false }]));
    act(() => result.current.stop());
    act(() => void vi.advanceTimersByTime(2000));

    expect(onText).toHaveBeenCalledWith('Проверить мобильную версию');
  });

  it('промежуточный текст виден во время речи', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.emit([{ transcript: 'Сделать', isFinal: false }]));
    expect(result.current.preview).toBe('Сделать');
  });

  it('склеивает фразы, сказанные с паузой', () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech(onText));
    act(() => result.current.toggle());
    act(() =>
      FakeRecognition.last!.emit([
        { transcript: 'Сделать мобильную версию', isFinal: true },
        { transcript: 'завтра 2 часа', isFinal: true }
      ])
    );
    act(() => result.current.stop());
    act(() => void vi.advanceTimersByTime(2000));

    expect(onText).toHaveBeenCalledWith('Сделать мобильную версию завтра 2 часа');
  });

  it('текст передаётся один раз', () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech(onText));
    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.emit([{ transcript: 'Задача', isFinal: true }]));
    act(() => result.current.stop());
    act(() => void vi.advanceTimersByTime(3000));
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('кнопка «Стоп» выключает запись сразу', () => {
    FakeRecognition.silentStop = true;
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(true);
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it('не висит вечно', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    act(() => void vi.advanceTimersByTime(61_000));
    expect(result.current.listening).toBe(false);
  });

  it('отказ в доступе к микрофону объясняется', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(result.current.error).toContain('микрофону');
    expect(result.current.listening).toBe(false);
  });

  it('ошибка запуска не оставляет режим записи', () => {
    FakeRecognition.throwOnStart = true;
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('без поддержки браузера ничего не происходит', () => {
    delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition;
    const { result } = renderHook(() => useSpeech(vi.fn()));
    expect(result.current.supported).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });
});
