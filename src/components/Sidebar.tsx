"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { StorageMeter } from "./StorageMeter";

export function Sidebar({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-requested-with": "fetch" },
    });
    router.replace("/login");
    router.refresh();
  }

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active
        ? "bg-blue-500/10 text-blue-400"
        : "text-slate-400 hover:bg-slate-800"
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 7l8-4 8 4-8 4-8-4zM4 7v6l8 4 8-4V7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-semibold text-slate-100">Mon espace</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <Link
          href="/folder/root"
          onClick={onNavigate}
          className={linkClass(pathname.startsWith("/folder"))}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
          Mes fichiers
        </Link>

        {isAdmin && (
          <>
            <p className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Administration
            </p>
            <Link
              href="/admin/users"
              onClick={onNavigate}
              className={linkClass(pathname === "/admin/users")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.87M16.5 4.13a4 4 0 010 7.75"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Utilisateurs
            </Link>
            <Link
              href="/admin/logins"
              onClick={onNavigate}
              className={linkClass(pathname === "/admin/logins")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
              Journal des connexions
            </Link>
          </>
        )}
      </nav>

      <div className="border-t border-slate-800">
        <StorageMeter />
        <div className="px-3 pb-4">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M16 17l5-5-5-5M21 12H9M12 19H6a2 2 0 01-2-2V7a2 2 0 012-2h6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
