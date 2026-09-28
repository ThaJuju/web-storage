"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import type { Crumb, PublicNode } from "@/lib/types";

/**
 * Navigateur de dossiers pour choisir une destination de deplacement.
 * Reutilise l'API de listing (GET /api/nodes?folder=). On empeche de deposer
 * un dossier dans lui-meme cote client (et le serveur re-verifie les cycles).
 */
export function MoveModal({
  node,
  onClose,
  onMove,
}: {
  node: PublicNode;
  onClose: () => void;
  onMove: (targetFolderId: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("root");
  const [folders, setFolders] = useState<PublicNode[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchFolder = useCallback(
    async (folderId: string) => {
      try {
        const res = await fetch(`/api/nodes?folder=${folderId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        setFolders(
          (data.children as PublicNode[]).filter(
            (c) => c.type === "FOLDER" && c.id !== node.id
          )
        );
        setCrumbs(data.breadcrumb);
        setCurrent(folderId);
      } finally {
        setLoading(false);
      }
    },
    [node.id]
  );

  const load = (folderId: string) => {
    setLoading(true);
    fetchFolder(folderId);
  };

  useEffect(() => {
    fetchFolder("root");
  }, [fetchFolder]);

  const cannotMoveHere = current === (node.parentId ?? "root");

  return (
    <Modal title={`Déplacer « ${node.name} »`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-400">
        <button onClick={() => load("root")} className="hover:text-blue-400">
          Racine
        </button>
        {crumbs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => load(c.id)} className="hover:text-blue-400">
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="mb-4 h-56 overflow-auto rounded-lg border border-slate-800">
        {loading ? (
          <p className="p-4 text-sm text-slate-400">Chargement…</p>
        ) : folders.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Aucun sous-dossier ici.</p>
        ) : (
          <ul>
            {folders.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => load(f.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800/60"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                    <path
                      d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
        >
          Annuler
        </button>
        <button
          disabled={cannotMoveHere || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onMove(current);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Déplacement…" : "Déplacer ici"}
        </button>
      </div>
    </Modal>
  );
}
