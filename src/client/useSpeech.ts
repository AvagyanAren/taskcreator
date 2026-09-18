import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API wrapper built to never leave the UI stuck.
 *
 * Mobile browsers are unreliable here: `onend` may never fire, `stop()` can be
 * ignored, and `start()` throws if a previous session is still alive. So the
 * hook never waits for the engine to confirm anything — state is reset locally
 * and the recognition object is aborted and thrown away.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

/** Hard stop: after this the session is dropped no matter what. */
const MAX_LISTENING_MS = 20_000;

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return (ctor as (new () => SpeechRecognitionLike) | undefined) ?? null;
}

export function useSpeech(onText: (text: string) => void, lang = 'ru-RU') {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so the callbacks never go stale between renders.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const supported = Boolean(getRecognitionCtor());

  /** Drops the session and clears the state, whatever the engine is doing. */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort?.();
        recognition.stop();
      } catch {
        /* already finished — nothing to do */
      }
    }
    setListening(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => cleanup(), [cleanup]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    cleanup(); // never start on top of a live session
    setError(null);

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Ctor();
    } catch {
      setError('Распознавание речи недоступно в этом браузере.');
      return;
    }

    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const text = Array.from(
        { length: event.results.length },
        (_, i) => event.results[i][0]?.transcript ?? ''
      )
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) onTextRef.current(text);
      cleanup();
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? '';
      setError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.'
          : code === 'no-speech'
            ? 'Речь не распознана — попробуйте ещё раз.'
            : 'Не удалось распознать речь.'
      );
      cleanup();
    };

    recognition.onend = () => cleanup();

    recognitionRef.current = recognition;
    setListening(true);

    // Safety net: some browsers never fire onend, which used to leave the
    // button stuck in "recording" with no way back.
    timerRef.current = setTimeout(() => {
      setError('Запись остановлена автоматически.');
      cleanup();
    }, MAX_LISTENING_MS);

    try {
      recognition.start();
    } catch {
      setError('Микрофон занят. Попробуйте ещё раз.');
      cleanup();
    }
  }, [cleanup, lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, toggle, stop };
}
