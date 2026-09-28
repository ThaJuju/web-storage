"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { UsageProvider } from "./UsageContext";
import { INACTIVITY_TIMEOUT_MS } from "@/lib/constants";
import { lastActivity, markActivity } from "@/lib/activity";

// Frequence de verification du minuteur d'inactivite.
const CHECK_INTERVAL_MS = 30 * 1000;
// Tant que l'utilisateur est actif, on prolonge la session serveur au plus
// toutes les 5 min (des interactions sans appel d'API, un long upload ou une
// video ne rafraichiraient sinon pas lastSeenAt).
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export function DriveShell({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  // Deconnexion automatique apres inactivite. L'activite est partagee entre
  // onglets (localStorage) et inclut uploads et lecture video (markActivity).
  // A l'echeance, on NE deconnecte PAS aveuglement : on demande au serveur si
  // la session est encore valide (c'est lui qui fait foi via lastSeenAt).
  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) =>
      window.addEventListener(e, markActivity, { passive: true })
    );
    markActivity();

    let lastHeartbeat = Date.now();
    let checking = false;

    async function sessionValid(touch: boolean): Promise<boolean | null> {
      try {
        const res = await fetch(
          `/api/auth/session${touch ? "?touch=1" : ""}`,
          { cache: "no-store" }
        );
        if (res.status === 401) return false;
        return res.ok ? true : null;
      } catch {
        return null; // erreur reseau : on ne conclut rien
      }
    }

    async function check() {
      if (checking) return;
      checking = true;
      try {
        const now = Date.now();
        const last = lastActivity();
        if (now - last < INACTIVITY_TIMEOUT_MS) {
          // Actif : heartbeat si de l'activite a eu lieu depuis le dernier.
          if (last > lastHeartbeat && now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = now;
            if ((await sessionValid(true)) === false) expired();
          }
          return;
        }
        // Inactif (tous onglets confondus) : le serveur tranche.
        if ((await sessionValid(false)) === false) expired();
      } finally {
        checking = false;
      }
    }

    function expired() {
      router.replace("/login");
      router.refresh();
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    // Onglet qui redevient visible (ordinateur sorti de veille...) : verifier
    // tout de suite plutot qu'au prochain tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
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
