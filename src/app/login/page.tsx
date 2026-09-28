"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(needTotp ? { totp } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.requiresTwoFactor) {
        setNeedTotp(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Échec de la connexion");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-[15px] text-slate-100 placeholder:text-slate-400 outline-none transition-colors duration-150 focus:border-blue-600 focus:ring-4 focus:ring-blue-500/20 disabled:bg-slate-800 disabled:text-slate-400";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7l8-4 8 4-8 4-8-4zM4 7v6l8 4 8-4V7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Mon espace de stockage
          </h1>
          <p className="mt-1.5 text-[15px] text-slate-400">
            Connectez-vous pour accéder à vos fichiers
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-7"
          noValidate
        >
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-semibold text-slate-300"
            >
              Adresse e-mail
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              value={email}
              disabled={needTotp}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="vous@exemple.fr"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-semibold text-slate-300"
            >
              Mot de passe
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                disabled={needTotp}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={needTotp}
                aria-label={
                  showPassword
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 transition-colors duration-150 hover:text-slate-200 disabled:opacity-40"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M3 3l18 18M10.6 10.6a2.5 2.5 0 003.5 3.5M7.4 7.5C4.9 8.9 3 12 3 12s3.5 6 9 6c1.4 0 2.7-.4 3.8-1M10 6.2A8.9 8.9 0 0112 6c5.5 0 9 6 9 6s-.7 1.2-1.9 2.5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {needTotp && (
            <div>
              <label
                htmlFor="totp"
                className="mb-1.5 block text-sm font-semibold text-slate-300"
              >
                Code de vérification (2FA)
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                required
                value={totp}
                onChange={(e) =>
                  setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className={`${inputClass} text-center text-xl tracking-[0.5em]`}
                placeholder="000000"
              />
              <p className="mt-1.5 text-xs text-slate-400">
                Saisissez le code à 6 chiffres de votre application
                d&apos;authentification.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 8v4.5M12 15.8v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
          >
            {loading && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                className="animate-spin"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
            {loading ? "Connexion…" : needTotp ? "Vérifier" : "Se connecter"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400">
          Accès réservé — aucune inscription publique.
        </p>
      </div>
    </main>
  );
}
