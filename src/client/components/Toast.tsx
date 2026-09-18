import { useEffect } from 'react';

export function Toast({
  message,
  href,
  tone = 'ok',
  onClose
}: {
  message: string;
  href?: string;
  tone?: 'ok' | 'warn';
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast ${tone}`} role="status">
      <span>{message}</span>
      {href && (
        <a href={href} target="_blank" rel="noreferrer">
          Открыть
        </a>
      )}
      <button className="toast-close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </div>
  );
}
