"use client";

import { useEffect, useState } from "react";
import type { PreviewComponentProps } from "./registry";

// Limite de securite : on ne charge pas un "texte" de plusieurs centaines de Mo.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Affichage en lecture d'un fichier texte, sans telechargement. */
export function TextPreview({ src, node }: PreviewComponentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = Number(node.size) > MAX_TEXT_BYTES;

  useEffect(() => {
    if (tooLarge) return;
    let cancelled = false;
    fetch(src, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => !cancelled && setContent(t))
      .catch(() => !cancelled && setError("Impossible de charger le fichier."));
    return () => {
      cancelled = true;
    };
  }, [src, tooLarge]);

  if (tooLarge) {
    return (
      <p className="p-6 text-sm text-slate-400">
        Fichier trop volumineux pour l&apos;aperçu.
      </p>
    );
  }
  if (error) {
    return <p className="p-6 text-sm text-slate-400">{error}</p>;
  }
  if (content === null) {
    return <p className="p-6 text-sm text-slate-400">Chargement…</p>;
  }
  return (
    <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-800 p-4 text-sm leading-relaxed text-slate-100">
      {content}
    </pre>
  );
}
