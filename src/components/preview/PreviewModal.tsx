"use client";

import { useEffect } from "react";
import type { PublicNode } from "@/lib/types";
import { getPreview } from "./registry";
import { formatBytes } from "@/lib/format";

export function PreviewModal({
  node,
  onClose,
}: {
  node: PublicNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = `/api/nodes/${node.id}/content`;
  const Preview = getPreview(node);

  return (
    <div
      // Clic dans le vide (fond noir) -> fermeture. L'en-tete et le media
      // (regroupes dans un meme bloc centre) stoppent la propagation.
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/70 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu de ${node.name}`}
    >
      {/* En-tete + media dans un seul bloc : le titre reste colle a la video. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-4xl flex-col"
      >
        <div className="flex items-center justify-between gap-4 pb-3 text-white">
          <div className="min-w-0">
            <p className="truncate font-medium">{node.name}</p>
            <p className="text-xs text-white/60">
              {formatBytes(Number(node.size))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`${src}?download=1`}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            >
              Télécharger
            </a>
            <button
              onClick={onClose}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              aria-label="Fermer"
            >
              Fermer
            </button>
          </div>
        </div>

        {Preview ? (
          <Preview node={node} src={src} />
        ) : (
          <div className="rounded-lg bg-slate-900 p-8 text-center">
            <p className="text-slate-400">
              Aperçu non disponible pour ce type de fichier.
            </p>
            <a
              href={`${src}?download=1`}
              className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Télécharger le fichier
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
