import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper over the Web Speech API. Supported in Chrome and Safari;
 * elsewhere `supported` stays false and the UI simply hides the button.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

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
  const supported = Boolean(getRecognitionCtor());

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const toggle = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript)
        .join(' ')
        .trim();
      if (text) onText(text);
    };
    recognition.onerror = () => {
      setError('Не удалось распознать речь. Проверьте доступ к микрофону.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Микрофон недоступен.');
    }
  }, [lang, listening, onText]);

  return { supported, listening, error, toggle };
}
