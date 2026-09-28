"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { UsageProvider } from "./UsageContext";
import { INACTIVITY_LOGOUT_MS } from "@/lib/constants";

export function DriveShell({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deconnexion automatique cote client apres inactivite (aligne sur le
  // TTL serveur). Reinitialise sur toute interaction.
  useEffect(() => {
    function reset() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }, INACTIVITY_LOGOUT_MS);
    }
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return (
    <UsageProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar desktop */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900 md:block">
          <Sidebar isAdmin={isAdmin} />
        </aside>

        {/* Sidebar mobile (drawer) */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-800 bg-slate-900">
              <Sidebar
                isAdmin={isAdmin}
                onNavigate={() => setMobileOpen(false)}
              />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barre mobile */}
          <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
              aria-label="Ouvrir le menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <span className="font-semibold text-slate-100">Mon espace</span>
          </div>

          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </UsageProvider>
  );
}
