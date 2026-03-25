'use client';

import Link from "next/link";
import { getProviders, signIn } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";

type ProviderMap = Record<string, { id: string; name: string }>;

export default function LoginPage() {
  const [providers, setProviders] = useState<ProviderMap | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);
  const [devPassword, setDevPassword] = useState("");
  const [devError, setDevError] = useState<string | null>(null);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const availableProviders = await getProviders();
        setProviders((availableProviders as ProviderMap | null) ?? {});
      } catch {
        setProviders({});
      }
    };

    void loadProviders();
  }, []);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    await signIn("google", { callbackUrl: "/" });
  };

  const handleDevSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDevError(null);
    setIsDevLoading(true);

    const result = await signIn("credentials", {
      redirect: false,
      callbackUrl: "/",
      password: devPassword,
    });

    setIsDevLoading(false);

    if (result?.error) {
      setDevError("Не удалось выполнить тестовый вход. Проверьте пароль.");
      return;
    }

    window.location.href = result?.url ?? "/";
  };

  const hasGoogleProvider = Boolean(providers?.google);
  const hasDevProvider = Boolean(providers?.credentials);

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-icon">🧾</div>
        <h1>Трекер расходов</h1>
        <p>Войдите, чтобы продолжить</p>

        {!providers && (
          <p className="login-helper">Загружаем доступные способы входа...</p>
        )}

        {hasGoogleProvider && (
          <button
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || isDevLoading}
            className="google-btn"
          >
            {isGoogleLoading ? (
              <span>Загрузка...</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Войти через Google
              </>
            )}
          </button>
        )}

        {hasDevProvider && (
          <form className="dev-login-box" onSubmit={handleDevSignIn}>
            <input
              type="password"
              value={devPassword}
              onChange={(event) => setDevPassword(event.target.value)}
              placeholder="Пароль для тестового входа"
              className="dev-login-input"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={isDevLoading || isGoogleLoading}
              className="google-btn dev-btn"
            >
              {isDevLoading ? "Входим..." : "Тестовый вход"}
            </button>
            {devError && <p className="login-helper login-error">{devError}</p>}
          </form>
        )}

        {providers && !hasGoogleProvider && !hasDevProvider && (
          <p className="login-helper login-error">
            Не настроен ни один способ входа. Проверьте переменные окружения.
          </p>
        )}

        <Link href="/demo" className="google-btn demo-login-link">
          Посмотреть демо без входа
        </Link>

        <p className="login-footer">Только для авторизованных пользователей</p>
      </div>
    </div>
  );
}
