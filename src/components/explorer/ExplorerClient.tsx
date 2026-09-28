"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FolderListing, PublicNode } from "@/lib/types";
import { useUsage } from "@/components/UsageContext";
import { formatBytes, formatDate } from "@/lib/format";
import { FileIcon } from "./FileIcon";
import { useUploader, filesFromDataTransfer } from "./useUploader";
import { UploadTray } from "./UploadTray";
import { PreviewModal } from "@/components/preview/PreviewModal";
import { canPreview } from "@/components/preview/registry";
import { Modal } from "@/components/Modal";
import { MoveModal } from "./MoveModal";

// Ouverture au clic simple UNIQUEMENT si : activation clavier (Enter/Espace,
// detail === 0) ou appareil tactile (tap simple attendu). A la souris, c'est le
// double-clic qui ouvre.
function opensOnSingleClick(e: React.MouseEvent): boolean {
  if (e.detail === 0) return true;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function ExplorerClient({ folderId }: { folderId: string }) {
  const router = useRouter();
  const { refresh: refreshUsage } = useUsage();

  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PublicNode[] | null>(null);

  const [preview, setPreview] = useState<PublicNode | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PublicNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<PublicNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicNode | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    node: PublicNode;
    x: number;
    y: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/nodes?folder=${folderId}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setError("Dossier introuvable.");
        return;
      }
      if (!res.ok) {
        setError("Erreur de chargement.");
        return;
      }
      setListing(await res.json());
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  const onEachUploadDone = useCallback(() => {
    load();
    refreshUsage();
  }, [load, refreshUsage]);

  const uploader = useUploader(onEachUploadDone);

  // --- Recherche (debounce) ---
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/nodes?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      if (res.ok) setSearchResults((await res.json()).results);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // --- Actions ---
  async function createFolder(name: string) {
    const res = await fetch("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: folderId, name }),
    });
    if (res.ok) {
      setNewFolderOpen(false);
      load();
      showToast("Dossier créé");
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error ?? "Échec de la création");
    }
  }

  async function rename(node: PublicNode, name: string) {
    const res = await fetch(`/api/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setRenameTarget(null);
      load();
      showToast("Renommé");
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error ?? "Échec du renommage");
    }
  }

  async function move(node: PublicNode, targetFolderId: string) {
    const res = await fetch(`/api/nodes/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: targetFolderId }),
    });
    if (res.ok) {
      setMoveTarget(null);
      load();
      showToast("Déplacé");
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error ?? "Échec du déplacement");
    }
  }

  async function remove(node: PublicNode) {
    const res = await fetch(`/api/nodes/${node.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteTarget(null);
      load();
      refreshUsage();
      showToast("Supprimé");
    } else {
      showToast("Échec de la suppression");
    }
  }

  function openNode(node: PublicNode) {
    if (node.type === "FOLDER") {
      router.push(`/folder/${node.id}`);
    } else if (canPreview(node)) {
      setPreview(node);
    } else {
      window.location.href = `/api/nodes/${node.id}/content?download=1`;
    }
  }

  // Clic droit sur un element -> menu contextuel a la position du curseur.
  function openContextMenu(node: PublicNode, e: React.MouseEvent) {
    e.preventDefault();
    setMenuFor(null); // ferme un eventuel menu "…" ouvert
    setContextMenu({ node, x: e.clientX, y: e.clientY });
  }

  // Ferme le menu contextuel au scroll, resize ou changement de dossier.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  // --- Drag & drop ---
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    filesFromDataTransfer(e.dataTransfer).then((inputs) => {
      if (inputs.length) uploader.upload(folderId, inputs);
    });
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const inputs = files.map((file) => {
      // webkitRelativePath rempli pour un upload de dossier.
      const rel = (file as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      return { file, relPath: rel || undefined };
    });
    if (inputs.length) uploader.upload(folderId, inputs);
    e.target.value = "";
  }

  const rows = searchResults ?? listing?.children ?? [];
  const isSearching = searchResults !== null;

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* En-tete : fil d'ariane + recherche */}
      <div className="border-b border-slate-800 bg-slate-900 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb
            crumbs={listing?.breadcrumb ?? []}
            onNavigate={(id) => router.push(`/folder/${id}`)}
            searching={isSearching}
          />
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher des fichiers"
              className="w-full min-w-40 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm outline-none transition-colors duration-150 focus:border-blue-600 focus:ring-4 focus:ring-blue-500/20 sm:w-64"
            />
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="absolute left-2.5 top-2.5 text-slate-400"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Barre d'actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <UploadIcon /> Importer des fichiers
          </button>
          <button
            onClick={() => dirInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800/60"
          >
            <FolderUpIcon /> Importer un dossier
          </button>
          <button
            onClick={() => setNewFolderOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800/60"
          >
            <NewFolderIcon /> Nouveau dossier
          </button>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
            <button
              onClick={() => setView("list")}
              className={`rounded p-1.5 ${view === "list" ? "bg-slate-800 text-slate-100" : "text-slate-400"}`}
              aria-label="Vue liste"
            >
              <ListIcon />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`rounded p-1.5 ${view === "grid" ? "bg-slate-800 text-slate-100" : "text-slate-400"}`}
              aria-label="Vue grille"
            >
              <GridIcon />
            </button>
          </div>
        </div>

        {/* Inputs caches */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={onPickFiles}
        />
        <input
          ref={dirInputRef}
          type="file"
          hidden
          onChange={onPickFiles}
          // @ts-expect-error attribut non standard mais supporte par les navigateurs
          webkitdirectory=""
          directory=""
        />
      </div>

      {/* Contenu */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-slate-400">Chargement…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            searching={isSearching}
            onImport={() => fileInputRef.current?.click()}
          />
        ) : view === "list" ? (
          <ListView
            rows={rows}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            onOpen={openNode}
            onRename={setRenameTarget}
            onMove={setMoveTarget}
            onDelete={setDeleteTarget}
            onContextMenu={openContextMenu}
          />
        ) : (
          <GridView
            rows={rows}
            onOpen={openNode}
            onRename={setRenameTarget}
            onMove={setMoveTarget}
            onDelete={setDeleteTarget}
            onContextMenu={openContextMenu}
          />
        )}
      </div>

      {/* Overlay drag & drop */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-blue-600/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-blue-500 bg-slate-900/90 px-8 py-6 text-center">
            <p className="font-medium text-blue-400">Déposez pour importer</p>
            <p className="text-sm text-slate-400">
              Fichiers ou dossiers dans « {currentFolderName(listing)} »
            </p>
          </div>
        </div>
      )}

      {/* File d'uploads */}
      <UploadTray items={uploader.items} onClear={uploader.clearDone} />

      {/* Toast */}
      {toast && (
        <div
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}

      {/* Menu contextuel (clic droit) */}
      {contextMenu && (
        <ContextMenu
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpen={openNode}
          onRename={setRenameTarget}
          onMove={setMoveTarget}
          onDelete={setDeleteTarget}
        />
      )}

      {/* Modales */}
      {preview && (
        <PreviewModal node={preview} onClose={() => setPreview(null)} />
      )}
      {newFolderOpen && (
        <NameModal
          title="Nouveau dossier"
          initial=""
          submitLabel="Créer"
          onClose={() => setNewFolderOpen(false)}
          onSubmit={createFolder}
        />
      )}
      {renameTarget && (
        <NameModal
          title={`Renommer « ${renameTarget.name} »`}
          initial={renameTarget.name}
          submitLabel="Renommer"
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => rename(renameTarget, name)}
        />
      )}
      {moveTarget && (
        <MoveModal
          node={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMove={(target) => move(moveTarget, target)}
        />
      )}
      {deleteTarget && (
        <Modal
          title="Confirmer la suppression"
          onClose={() => setDeleteTarget(null)}
        >
          <p className="mb-5 text-sm text-slate-400">
            Supprimer{" "}
            <span className="font-medium text-slate-100">
              « {deleteTarget.name} »
            </span>
            {deleteTarget.type === "FOLDER"
              ? " et tout son contenu ? "
              : " ? "}
            Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
            >
              Annuler
            </button>
            <button
              onClick={() => remove(deleteTarget)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Supprimer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function currentFolderName(listing: FolderListing | null): string {
  if (!listing || listing.breadcrumb.length === 0) return "Mes fichiers";
  return listing.breadcrumb[listing.breadcrumb.length - 1].name;
}

// --- Fil d'ariane ---
function Breadcrumb({
  crumbs,
  onNavigate,
  searching,
}: {
  crumbs: { id: string; name: string }[];
  onNavigate: (id: string) => void;
  searching: boolean;
}) {
  if (searching) {
    return <p className="text-lg font-semibold text-slate-100">Résultats de recherche</p>;
  }
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm">
      <button
        onClick={() => onNavigate("root")}
        className="font-medium text-slate-400 hover:text-blue-400"
      >
        Mes fichiers
      </button>
      {crumbs.map((c, i) => (
        <span key={c.id} className="flex items-center gap-1">
          <span className="text-slate-600">/</span>
          <button
            onClick={() => onNavigate(c.id)}
            className={`hover:text-blue-400 ${
              i === crumbs.length - 1
                ? "font-semibold text-slate-100"
                : "text-slate-400"
            }`}
          >
            {c.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

// --- Vue liste ---
function ListView({
  rows,
  menuFor,
  setMenuFor,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onContextMenu,
}: {
  rows: PublicNode[];
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  onOpen: (n: PublicNode) => void;
  onRename: (n: PublicNode) => void;
  onMove: (n: PublicNode) => void;
  onDelete: (n: PublicNode) => void;
  onContextMenu: (n: PublicNode, e: React.MouseEvent) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
          <th className="py-2 font-medium">Nom</th>
          <th className="hidden py-2 font-medium sm:table-cell">Taille</th>
          <th className="hidden py-2 font-medium md:table-cell">Modifié</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((node) => (
          <tr
            key={node.id}
            onDoubleClick={() => onOpen(node)}
            onContextMenu={(e) => onContextMenu(node, e)}
            className="group cursor-default select-none border-b border-slate-800/70 hover:bg-slate-800/60"
          >
            <td className="py-2.5">
              <button
                // Souris : ouverture au double-clic sur la ligne. Clavier /
                // tactile : ouverture au clic simple (accessibilite + mobile).
                onClick={(e) => {
                  if (opensOnSingleClick(e)) onOpen(node);
                }}
                className="flex items-center gap-3 text-left"
              >
                <FileIcon node={node} />
                <span className="font-medium text-slate-200">{node.name}</span>
              </button>
            </td>
            <td className="hidden py-2.5 text-slate-400 sm:table-cell">
              {node.type === "FILE" ? formatBytes(Number(node.size)) : "—"}
            </td>
            <td className="hidden py-2.5 text-slate-400 md:table-cell">
              {formatDate(node.updatedAt)}
            </td>
            <td className="py-2.5 text-right">
              <RowMenu
                node={node}
                open={menuFor === node.id}
                onToggle={() =>
                  setMenuFor(menuFor === node.id ? null : node.id)
                }
                onClose={() => setMenuFor(null)}
                onOpen={onOpen}
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Vue grille ---
function GridView({
  rows,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onContextMenu,
}: {
  rows: PublicNode[];
  onOpen: (n: PublicNode) => void;
  onRename: (n: PublicNode) => void;
  onMove: (n: PublicNode) => void;
  onDelete: (n: PublicNode) => void;
  onContextMenu: (n: PublicNode, e: React.MouseEvent) => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {rows.map((node) => (
        <div
          key={node.id}
          onDoubleClick={() => onOpen(node)}
          onContextMenu={(e) => onContextMenu(node, e)}
          className="group relative cursor-default select-none rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-blue-500/60 hover:shadow-sm"
        >
          <div className="absolute right-2 top-2">
            <RowMenu
              node={node}
              open={menuFor === node.id}
              onToggle={() => setMenuFor(menuFor === node.id ? null : node.id)}
              onClose={() => setMenuFor(null)}
              onOpen={onOpen}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          </div>
          <button
            // Souris : ouverture au double-clic sur la carte. Clavier / tactile :
            // ouverture au clic simple (accessibilite + mobile).
            onClick={(e) => {
              if (opensOnSingleClick(e)) onOpen(node);
            }}
            className="flex w-full flex-col items-center gap-2 text-center"
          >
            <div className="scale-150 py-3">
              <FileIcon node={node} />
            </div>
            <span className="line-clamp-2 break-all text-sm font-medium text-slate-200">
              {node.name}
            </span>
            <span className="text-xs text-slate-400">
              {node.type === "FILE" ? formatBytes(Number(node.size)) : "Dossier"}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

// Liste d'actions partagee entre le menu "…" et le menu contextuel (clic droit).
function NodeMenuItems({
  node,
  onClose,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  node: PublicNode;
  onClose: () => void;
  onOpen: (n: PublicNode) => void;
  onRename: (n: PublicNode) => void;
  onMove: (n: PublicNode) => void;
  onDelete: (n: PublicNode) => void;
}) {
  const downloadUrl =
    node.type === "FILE"
      ? `/api/nodes/${node.id}/content?download=1`
      : `/api/nodes/${node.id}/zip`;

  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-300 hover:bg-slate-800/60";

  return (
    <>
      <button
        onClick={() => {
          onClose();
          onOpen(node);
        }}
        className={itemClass}
      >
        <EyeIcon /> Ouvrir
      </button>
      <a href={downloadUrl} onClick={onClose} className={itemClass}>
        <DownloadIcon />
        {node.type === "FILE" ? "Télécharger" : "Télécharger (.zip)"}
      </a>
      <button
        onClick={() => {
          onClose();
          onRename(node);
        }}
        className={itemClass}
      >
        <RenameIcon /> Renommer
      </button>
      <button
        onClick={() => {
          onClose();
          onMove(node);
        }}
        className={itemClass}
      >
        <MoveIcon /> Déplacer
      </button>
      <div className="my-1 border-t border-slate-800" />
      <button
        onClick={() => {
          onClose();
          onDelete(node);
        }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-400 hover:bg-red-500/10"
      >
        <TrashIcon /> Supprimer
      </button>
    </>
  );
}

// --- Menu "…" d'une ligne ---
function RowMenu({
  node,
  open,
  onToggle,
  onClose,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  node: PublicNode;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpen: (n: PublicNode) => void;
  onRename: (n: PublicNode) => void;
  onMove: (n: PublicNode) => void;
  onDelete: (n: PublicNode) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-700 hover:text-slate-200 group-hover:opacity-100 aria-expanded:opacity-100"
        aria-expanded={open}
        aria-label="Actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 py-1 text-sm shadow-lg">
            <NodeMenuItems
              node={node}
              onClose={onClose}
              onOpen={onOpen}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          </div>
        </>
      )}
    </div>
  );
}

// --- Menu contextuel au clic droit, positionne au curseur ---
function ContextMenu({
  node,
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  node: PublicNode;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (n: PublicNode) => void;
  onRename: (n: PublicNode) => void;
  onMove: (n: PublicNode) => void;
  onDelete: (n: PublicNode) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Borne le menu dans le viewport une fois sa taille connue.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top) });
  }, [x, y]);

  return (
    <>
      {/* Capture le clic exterieur (gauche ou droit) pour fermer. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.left, top: pos.top }}
        className="fixed z-50 w-48 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 py-1 text-sm shadow-xl"
      >
        <NodeMenuItems
          node={node}
          onClose={onClose}
          onOpen={onOpen}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
    </>
  );
}

// --- Modale de saisie de nom (creation / renommage) ---
function NameModal({
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          try {
            await onSubmit(value.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          placeholder="Nom"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EmptyState({
  searching,
  onImport,
}: {
  searching: boolean;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-3 text-slate-600">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </div>
      <p className="text-sm text-slate-400">
        {searching
          ? "Aucun résultat pour cette recherche."
          : "Ce dossier est vide."}
      </p>
      {!searching && (
        <button
          onClick={onImport}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-700"
        >
          Importer des fichiers
        </button>
      )}
      {!searching && (
        <p className="mt-2 text-xs text-slate-400">
          ou glissez-déposez des fichiers n&apos;importe où sur cette page
        </p>
      )}
    </div>
  );
}

// --- Icones ---
function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FolderUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 16v-4m0 0l-1.5 1.5M12 12l1.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function NewFolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v4m-2-2h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

// Icones du menu d'actions (16px, stroke 1.6, homogenes avec le reste).
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2 2 0 000-3l-1-1a2 2 0 00-3 0L4 16v4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.5 7.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 15l3-3-3-3M15 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a1 1 0 01-1 1H7a1 1 0 01-1-1V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
