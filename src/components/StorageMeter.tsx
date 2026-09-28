"use client";

import { useUsage } from "./UsageContext";
import { formatBytes } from "@/lib/format";

/** Indicateur de consommation d'espace, affiche en bas de la sidebar. */
export function StorageMeter() {
  const { usedBytes, quotaBytes, loading } = useUsage();
  const pct =
    quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  // Couleur progressive : bleu -> ambre a 75 % -> rouge a 90 %.
  const barColor =
    pct >= 90 ? "bg-red-500/100" : pct >= 75 ? "bg-amber-500" : "bg-blue-600";

  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        Stockage
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-700"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Espace de stockage utilisé"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {loading
          ? "Calcul…"
          : `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)} utilisés`}
      </p>
    </div>
  );
}
