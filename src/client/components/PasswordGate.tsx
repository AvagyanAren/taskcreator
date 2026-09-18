import { useState } from 'react';

export function PasswordGate({ onSubmit, error }: { onSubmit: (value: string) => void; error: string | null }) {
  const [value, setValue] = useState('');
  return (
    <div className="card gate">
      <h2>Вход</h2>
      <p className="hint">
        Приложение создаёт задачи в рабочем проекте, поэтому закрыто паролем.
        Это значение переменной <code>APP_PASSWORD</code> в настройках Vercel.
      </p>
      <p className="hint">Введённая задача сохранена — после входа вы вернётесь к ней.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <label htmlFor="pw">Пароль</label>
        <input
          id="pw"
          type="password"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <div className="banner error">{error}</div>}
        <button className="primary" type="submit" disabled={!value.trim()}>
          Войти
        </button>
      </form>
    </div>
  );
}
