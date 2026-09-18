import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeech } from './useSpeech.js';

/**
 * A stand-in for the browser engine that behaves as badly as real phones do:
 * it can stay silent forever, ignore stop(), or throw on start().
 */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  static throwOnStart = false;
  static ignoreStop = false;

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  aborted = false;

  onstart: (() => void) | null = null;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error('already started');
    this.started = true;
  }
  stop() {
    if (FakeRecognition.ignoreStop) return;
    this.started = false;
  }
  abort() {
    this.aborted = true;
    this.started = false;
  }
  emitResult(transcript: string) {
    this.onresult?.({ results: [[{ transcript }]] });
  }
  emitError(error: string) {
    this.onerror?.({ error });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.last = null;
  FakeRecognition.throwOnStart = false;
  FakeRecognition.ignoreStop = false;
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition;
});

describe('голосовой ввод', () => {
  it('распознаёт речь и сам выключается', () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech(onText));

    expect(result.current.supported).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(true);

    act(() => FakeRecognition.last!.emitResult('Сделать адаптив, завтра, 2h'));
    expect(onText).toHaveBeenCalledWith('Сделать адаптив, завтра, 2h');
    expect(result.current.listening).toBe(false);
  });

  it('кнопка «Стоп» выключает запись', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(true);

    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  // Это и был баг на телефоне: движок игнорировал stop() и не присылал onend,
  // из-за чего интерфейс навсегда оставался в состоянии записи.
  it('выключается, даже если браузер игнорирует stop()', () => {
    FakeRecognition.ignoreStop = true;
    const { result } = renderHook(() => useSpeech(vi.fn()));

    act(() => result.current.toggle());
    expect(result.current.listening).toBe(true);

    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
    expect(FakeRecognition.last!.aborted).toBe(true);
  });

  it('не висит вечно: автоостановка по таймауту', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(true);

    act(() => void vi.advanceTimersByTime(21_000));
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('отказ в доступе к микрофону понятно объясняется', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    act(() => FakeRecognition.last!.emitError('not-allowed'));

    expect(result.current.listening).toBe(false);
    expect(result.current.error).toContain('микрофону');
  });

  it('ошибка запуска не оставляет интерфейс в состоянии записи', () => {
    FakeRecognition.throwOnStart = true;
    const { result } = renderHook(() => useSpeech(vi.fn()));

    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('повторный запуск не накладывается на предыдущий', () => {
    const { result } = renderHook(() => useSpeech(vi.fn()));
    act(() => result.current.toggle());
    const first = FakeRecognition.last!;

    act(() => result.current.stop());
    act(() => result.current.toggle());

    expect(first.aborted).toBe(true);
    expect(FakeRecognition.last).not.toBe(first);
    expect(result.current.listening).toBe(true);
  });

  it('без поддержки в браузере кнопка не показывается', () => {
    delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition;
    const { result } = renderHook(() => useSpeech(vi.fn()));
    expect(result.current.supported).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });
});
