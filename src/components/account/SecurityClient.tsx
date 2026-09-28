"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

interface Status {
  enabled: boolean;
  recoveryCodesLeft: number;
}

type Step =
  | { kind: "idle" }
  | { kind: "setup"; qr: string; secret: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "regenerate" }
  | { kind: "disable" };

async function post(payload: Record<string, unknown>) {
  const res = await fetch("/api/account/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return { ok: !!res?.ok, data, network: !res };
}

/** Page « Sécurité » : enrolement et gestion de la 2FA (TOTP). */
export function SecurityClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // setState uniquement dans le callback .then() : jamais synchrone dans l'effet.
  const load = useCallback(
    () =>
      fetchJson<Status>("/api/account/2fa").then(({ data }) => {
        if (data) setStatus(data);
      }),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  function reset(next: Step = { kind: "idle" }) {
    setStep(next);
    setCode("");
    setPassword("");
    setErr(null);
  }

  async function run(
    payload: Record<string, unknown>,
    onOk: (data: Record<string, unknown>) => void
  ) {
    setBusy(true);
    setErr(null);
    try {
      const { ok, data, network } = await post(payload);
      if (!ok) {
        setErr(network ? "Erreur réseau." : data.error ?? "Échec de l'opération");
        return;
      }
      onOk(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl px-6 py-6">
      <h1 className="mb-1 text-lg font-semibold text-slate-100">Sécurité</h1>
      <p className="mb-6 text-sm text-slate-400">
        Protégez votre compte avec une double authentification (2FA).
      </p>

      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-100">
              Application d&apos;authentification
            </h2>
            <p className="text-sm text-slate-400">
              Google Authenticator, Aegis, 1Password… : un code à 6 chiffres
              est demandé à chaque connexion.
            </p>
          </div>
          {status &&
            (status.enabled ? (
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                Activée
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400">
                Désactivée
              </span>
            ))}
        </div>

        {/* 2FA desactivee : enrolement */}
        {status && !status.enabled && step.kind === "idle" && (
          <button
            onClick={() =>
              run({ action: "setup" }, (d) =>
                reset({
                  kind: "setup",
                  qr: d.qr as string,
                  secret: d.secret as string,
                })
              )
            }
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Activer la 2FA
          </button>
        )}

        {step.kind === "setup" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run({ action: "enable", code }, (d) => {
                reset({ kind: "codes", codes: d.recoveryCodes as string[] });
                load();
              });
            }}
            className="space-y-4"
          >
            <p className="text-sm text-slate-300">
              1. Scannez ce QR code avec votre application
              d&apos;authentification.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL generee cote serveur */}
            <img
              src={step.qr}
              alt="QR code d'enrôlement 2FA"
              width={180}
              height={180}
              className="rounded-lg bg-white p-2"
            />
            <p className="text-xs text-slate-400">
              Ou saisissez la clé manuellement :{" "}
              <code className="select-all break-all rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                {step.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
            </p>
            <label className="block text-sm text-slate-300">
              2. Saisissez le code à 6 chiffres affiché :
              <CodeInput value={code} onChange={setCode} />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Vérifier et activer
              </button>
              <button
                type="button"
                onClick={() => reset()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
              >
                Annuler
              </button>
            </div>
          </form>
        )}

        {step.kind === "codes" && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-300">
              Codes de récupération
            </p>
            <p className="text-sm text-amber-100/80">
              Chaque code permet une connexion si vous perdez votre téléphone.
              Conservez-les en lieu sûr : ils ne seront plus affichés.
            </p>
            <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm text-slate-100">
              {step.codes.map((c) => (
                <li key={c} className="select-all rounded bg-slate-900 px-2 py-1">
                  {c}
                </li>
              ))}
            </ul>
            <button
              onClick={() => reset()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              J&apos;ai noté mes codes
            </button>
          </div>
        )}

        {/* 2FA activee : gestion */}
        {status?.enabled && step.kind === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              {status.recoveryCodesLeft} code
              {status.recoveryCodesLeft > 1 ? "s" : ""} de récupération
              restant{status.recoveryCodesLeft > 1 ? "s" : ""}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => reset({ kind: "regenerate" })}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              >
                Nouveaux codes de récupération
              </button>
              <button
                onClick={() => reset({ kind: "disable" })}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
              >
                Désactiver la 2FA
              </button>
            </div>
          </div>
        )}

        {(step.kind === "regenerate" || step.kind === "disable") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step.kind === "regenerate") {
                run({ action: "regenerate", code }, (d) => {
                  reset({ kind: "codes", codes: d.recoveryCodes as string[] });
                  load();
                });
              } else {
                run({ action: "disable", code, password }, () => {
                  reset();
                  load();
                });
              }
            }}
            className="space-y-3"
          >
            {step.kind === "disable" && (
              <label className="block text-sm text-slate-300">
                Mot de passe
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
            )}
            <label className="block text-sm text-slate-300">
              Code 2FA (ou code de récupération)
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                autoComplete="one-time-code"
                className={`${inputClass} mt-1.5 font-mono`}
                placeholder="123456"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !code || (step.kind === "disable" && !password)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  step.kind === "disable"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {step.kind === "disable" ? "Désactiver" : "Générer"}
              </button>
              <button
                type="button"
                onClick={() => reset()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
              >
                Annuler
              </button>
            </div>
          </form>
        )}

        {err && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
          >
            {err}
          </p>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-500">
        Activer ou désactiver la 2FA déconnecte vos autres sessions ouvertes.
      </p>
    </div>
  );
}

function CodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className={`${inputClass} mt-1.5 max-w-40 text-center font-mono text-lg tracking-[0.4em]`}
      placeholder="000000"
    />
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors duration-150 focus:border-blue-600 focus:ring-4 focus:ring-blue-500/20";
