"use client";

import { useEffect } from "react";
import type { UploadItem } from "./useUploader";

/** Panneau flottant affichant la progression des uploads en cours. */
export function UploadTray({
  items,
  onClear,
}: {
  items: UploadItem[];
  onClear: () => void;
}) {
  const allDone =
    items.length > 0 && items.every((i) => i.status !== "uploading");

  // Une fois tous les envois termines, la file se retire d'elle-meme apres 5 s.
  // Le minuteur repart si un nouvel upload arrive (allDone repasse a false).
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(onClear, 5000);
    return () => clearTimeout(t);
  }, [allDone, onClear]);

  if (items.length === 0) return null;
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/70 px-4 py-2.5">
        <span className="text-sm font-medium text-slate-300">
          {allDone
            ? `${doneCount}/${items.length} importé(s)`
            : `Import… ${doneCount}/${items.length}`}
        </span>
        {allDone && (
          <button
            onClick={onClear}
            className="text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            Fermer
          </button>
        )}
      </div>
      <ul className="max-h-56 overflow-auto">
        {items.map((it) => (
          <li key={it.id} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-slate-300" title={it.name}>
                {it.name}
              </span>
              <span className="shrink-0 text-xs">
                {it.status === "done" && (
                  <span className="text-emerald-400">✓</span>
                )}
                {it.status === "error" && (
                  <span className="text-red-400" title={it.error}>
                    ✕
                  </span>
                )}
                {it.status === "uploading" && (
                  <span className="text-slate-400">{it.progress}%</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${
                  it.status === "error"
                    ? "bg-red-500/100"
                    : it.status === "done"
                      ? "bg-emerald-500/100"
                      : "bg-blue-500/100"
                }`}
                style={{ width: `${it.progress}%` }}
              />
            </div>
            {it.status === "error" && it.error && (
              <p className="mt-0.5 text-xs text-red-400">{it.error}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
