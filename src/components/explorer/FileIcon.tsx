"use client";

import type { PublicNode } from "@/lib/types";

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Icone simple selon le type / l'extension. */
export function FileIcon({ node }: { node: PublicNode }) {
  if (node.type === "FOLDER") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-blue-500">
        <path
          d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
          fill="currentColor"
          fillOpacity="0.15"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  // Convention du design system : dossiers bleus, fichiers ambre par defaut.
  const e = ext(node.name);
  let color = "text-amber-500";
  if (["mp4", "webm", "mov", "ogv"].includes(e)) color = "text-purple-500";
  else if (["txt", "md", "log", "csv", "json"].includes(e))
    color = "text-emerald-500";
  else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e))
    color = "text-rose-400";

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={color}>
      <path
        d="M6 2h8l4 4v14a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
