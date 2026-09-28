"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Modal } from "@/components/Modal";
import { formatBytes, formatDate } from "@/lib/format";

interface UserRow {
  id: string;
  email: string;
  isAdmin: boolean;
  twoFactor: boolean;
  usedBytes: string;
  quotaBytes: string;
  fileCount: number;
  createdAt: string;
  isSelf: boolean;
}

interface Totals {
  userCount: number;
  adminCount: number;
  usedBytes: string;
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState<UserRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  }, []);

  // setState uniquement dans le callback .then() : jamais synchrone dans l'effet.
  const load = useCallback(
    () =>
      fetchJson<{ users: UserRow[]; totals: Totals }>("/api/admin/users").then(({ res, data }) => {
        if (data) {
          setUsers(data.users);
          setTotals(data.totals);
          setError(null);
        } else {
          setError(res ? "Erreur de chargement." : "Erreur réseau.");
        }
        setLoading(false);
      }),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  // Garde le modal de gestion synchronisé avec les données rechargées.
  const refreshedManage = manage
    ? users.find((u) => u.id === manage.id) ?? null
    : null;

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Utilisateurs</h1>
          <p className="text-sm text-slate-400">
            Créez et gérez les comptes, les mots de passe et les quotas.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-700"
        >
          <PlusIcon /> Nouvel utilisateur
        </button>
      </div>

      {/* Totaux */}
      {totals && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Comptes" value={String(totals.userCount)} />
          <StatCard label="Administrateurs" value={String(totals.adminCount)} />
          <StatCard
            label="Stockage total utilisé"
            value={formatBytes(Number(totals.usedBytes))}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 font-medium">E-mail</th>
                <th className="px-4 py-2.5 font-medium">Rôle</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                  Stockage
                </th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">
                  Fichiers
                </th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">
                  Créé le
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const used = Number(u.usedBytes);
                const quota = Number(u.quotaBytes);
                const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
                return (
                  <tr key={u.id} className="border-b border-slate-800/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-200">
                          {u.email}
                        </span>
                        {u.isSelf && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                            vous
                          </span>
                        )}
                        {u.twoFactor && (
                          <span
                            title="2FA activée"
                            className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
                          >
                            2FA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.isAdmin ? (
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                          Admin
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Utilisateur
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="w-40">
                        <div className="mb-1 flex justify-between text-xs text-slate-400">
                          <span>{formatBytes(used)}</span>
                          <span>{formatBytes(quota)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 90
                                ? "bg-red-500"
                                : pct >= 75
                                  ? "bg-amber-500"
                                  : "bg-blue-600"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 lg:table-cell">
                      {u.fileCount}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 lg:table-cell">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setManage(u)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors duration-150 hover:bg-slate-800"
                      >
                        Gérer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(msg) => {
            setCreateOpen(false);
            load();
            showToast(msg);
          }}
        />
      )}

      {refreshedManage && (
        <ManageUserModal
          user={refreshedManage}
          onClose={() => setManage(null)}
          onChanged={(msg, close) => {
            load();
            showToast(msg);
            if (close) setManage(null);
          }}
        />
      )}

      {toast && (
        <div
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

// --- Création ---
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [quotaGb, setQuotaGb] = useState("50");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          quotaGb: Number(quotaGb),
          isAdmin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Échec de la création");
        return;
      }
      onCreated(`Compte ${email} créé`);
    } catch {
      setErr("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouvel utilisateur" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Adresse e-mail">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="utilisateur@exemple.fr"
          />
        </Field>
        <Field label="Mot de passe (10 caractères min.)">
          <input
            type="text"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Mot de passe initial"
          />
        </Field>
        <Field label="Quota (Go)">
          <input
            type="number"
            min={1}
            step={1}
            required
            value={quotaGb}
            onChange={(e) => setQuotaGb(e.target.value)}
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          Administrateur
        </label>

        {err && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Gestion d'un compte ---
function ManageUserModal({
  user,
  onClose,
  onChanged,
}: {
  user: UserRow;
  onClose: () => void;
  onChanged: (msg: string, close?: boolean) => void;
}) {
  const [quotaGb, setQuotaGb] = useState(
    String(Math.round(Number(user.quotaBytes) / 1_000_000_000))
  );
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>, action: string, msg: string) {
    setErr(null);
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Échec de la modification");
        return false;
      }
      onChanged(msg);
      return true;
    } catch {
      setErr("Erreur réseau.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setErr(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Échec de la suppression");
        return;
      }
      onChanged(`Compte ${user.email} supprimé`, true);
    } catch {
      setErr("Erreur réseau.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Gérer « ${user.email} »`} onClose={onClose}>
      <div className="space-y-5">
        {/* Quota + rôle */}
        <div className="space-y-3">
          <Field label="Quota (Go)">
            <input
              type="number"
              min={1}
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={isAdmin}
              disabled={user.isSelf}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="h-4 w-4 accent-blue-600 disabled:opacity-50"
            />
            Administrateur
            {user.isSelf && (
              <span className="text-xs text-slate-500">
                (vous ne pouvez pas modifier votre propre rôle)
              </span>
            )}
          </label>
          <button
            onClick={() =>
              patch(
                { quotaGb: Number(quotaGb), isAdmin },
                "save",
                "Modifications enregistrées"
              )
            }
            disabled={busy !== null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "save" ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>

        <div className="border-t border-slate-800" />

        {/* Mot de passe */}
        <div className="space-y-2">
          <Field label="Nouveau mot de passe (10 car. min.)">
            <div className="flex gap-2">
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                placeholder="Laisser vide pour ne pas changer"
              />
              <button
                onClick={async () => {
                  const ok = await patch(
                    { password: newPassword },
                    "password",
                    "Mot de passe mis à jour"
                  );
                  if (ok) setNewPassword("");
                }}
                disabled={newPassword.length < 10 || busy !== null}
                className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Changer
              </button>
            </div>
          </Field>
        </div>

        {/* 2FA */}
        {user.twoFactor && (
          <div>
            <button
              onClick={() =>
                patch(
                  { disableTwoFactor: true },
                  "2fa",
                  "2FA réinitialisée"
                )
              }
              disabled={busy !== null}
              className="text-sm font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50"
            >
              Réinitialiser la 2FA de ce compte
            </button>
          </div>
        )}

        <div className="border-t border-slate-800" />

        {/* Suppression */}
        <div>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={user.isSelf}
              title={
                user.isSelf ? "Vous ne pouvez pas supprimer votre compte" : ""
              }
              className="text-sm font-medium text-red-400 hover:text-red-300 disabled:opacity-40"
            >
              Supprimer ce compte et tous ses fichiers
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="mb-3 text-sm text-red-300">
                Supprimer définitivement « {user.email} » et l&apos;intégralité
                de ses fichiers ? Cette action est irréversible.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
                >
                  Annuler
                </button>
                <button
                  onClick={remove}
                  disabled={busy !== null}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy === "delete" ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          )}
        </div>

        {err && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors duration-150 focus:border-blue-600 focus:ring-4 focus:ring-blue-500/20";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-300">
        {label}
      </label>
      {children}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
