import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API wrapper.
 *
 * Two lessons are baked in here:
 *  - `abort()` throws the result away, `stop()` delivers it — so a manual stop
 *    must use `stop()`, and `abort()` is only the last-resort escape hatch;
 *  - phones may never fire `onend`, so the UI state is always reset locally.
 *
 * Interim results are accumulated as they arrive, which means whatever was
 * recognised so far reaches the field even if the session dies unexpectedly.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult:
    | ((event: {
        resultIndex?: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

/** Hard stop for a session nobody ended. */
const MAX_LISTENING_MS = 60_000;
/** How long to wait for the engine's closing result after a manual stop. */
const FINALIZE_GRACE_MS = 1_500;

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return (ctor as (new () => SpeechRecognitionLike) | undefined) ?? null;
}

export function useSpeech(onText: (text: string) => void, lang = 'ru-RU') {
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTextRef = useRef('');
  const interimTextRef = useRef('');
  const deliveredRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const supported = Boolean(getRecognitionCtor());

  const clearTimers = () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    maxTimerRef.current = null;
    graceTimerRef.current = null;
  };

  /** Hands over everything recognised so far. Safe to call more than once. */
  const finalize = useCallback(() => {
    clearTimers();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort?.();
      } catch {
        /* already gone */
      }
    }

    const text = `${finalTextRef.current} ${interimTextRef.current}`.replace(/\s+/g, ' ').trim();
    if (text && !deliveredRef.current) {
      deliveredRef.current = true;
      onTextRef.current(text);
    }

    finalTextRef.current = '';
    interimTextRef.current = '';
    setPreview('');
    setListening(false);
  }, []);

  useEffect(() => finalize, [finalize]);

  /** User pressed stop: ask the engine to deliver, then finalize regardless. */
  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    setListening(false);
    if (!recognition) {
      finalize();
      return;
    }
    try {
      recognition.stop();
    } catch {
      /* ignore — finalize below handles it */
    }
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(finalize, FINALIZE_GRACE_MS);
  }, [finalize]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    finalize();
    setError(null);
    deliveredRef.current = false;
    finalTextRef.current = '';
    interimTextRef.current = '';

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Ctor();
    } catch {
      setError('Распознавание речи недоступно в этом браузере.');
      return;
    }

    recognition.lang = lang;
    // Keep listening through pauses — a task sentence is rarely said in one go.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += ` ${transcript}`;
        else interim += ` ${transcript}`;
      }
      finalTextRef.current = finalText.replace(/\s+/g, ' ').trim();
      interimTextRef.current = interim.replace(/\s+/g, ' ').trim();
      setPreview(`${finalTextRef.current} ${interimTextRef.current}`.trim());
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? '';
      if (code === 'no-speech' && (finalTextRef.current || interimTextRef.current)) {
        finalize();
        return;
      }
      setError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.'
          : code === 'no-speech'
            ? 'Речь не распознана — попробуйте ещё раз.'
            : code === 'aborted'
              ? null
              : 'Не удалось распознать речь.'
      );
      finalize();
    };

    recognition.onend = () => finalize();

    recognitionRef.current = recognition;
    setListening(true);
    setPreview('');

    maxTimerRef.current = setTimeout(() => {
      setError('Запись остановлена автоматически.');
      finalize();
    }, MAX_LISTENING_MS);

    try {
      recognition.start();
    } catch {
      setError('Микрофон занят. Попробуйте ещё раз.');
      finalize();
    }
  }, [finalize, lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, preview, toggle, stop };
}
