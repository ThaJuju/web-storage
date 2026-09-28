"use client";

import type { PublicNode } from "@/lib/types";
import { VideoPreview } from "./VideoPreview";
import { TextPreview } from "./TextPreview";
import { ImagePreview } from "./ImagePreview";

/**
 * Registre des previews. POINT D'EXTENSION : pour ajouter un format, ecrire un
 * composant PreviewComponent et l'enregistrer ici avec un predicat `match`.
 * L'ordre compte : le premier predicat vrai gagne.
 */
export interface PreviewComponentProps {
  node: PublicNode;
  src: string; // URL de la route content authentifiee
}

type PreviewEntry = {
  match: (node: PublicNode) => boolean;
  Component: React.ComponentType<PreviewComponentProps>;
};

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

const registry: PreviewEntry[] = [
  {
    // Video (mp4 en priorite, extensible aux autres conteneurs lisibles).
    match: (n) =>
      n.mimeType?.startsWith("video/") === true ||
      ["mp4", "webm", "ogv", "mov"].includes(ext(n.name)),
    Component: VideoPreview,
  },
  {
    // Texte brut.
    match: (n) =>
      n.mimeType?.startsWith("text/") === true ||
      ["txt", "md", "log", "csv", "json", "xml", "yml", "yaml"].includes(
        ext(n.name)
      ),
    Component: TextPreview,
  },
  {
    // Images (bonus, montre l'extensibilite).
    match: (n) =>
      n.mimeType?.startsWith("image/") === true ||
      ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(
        ext(n.name)
      ),
    Component: ImagePreview,
  },
];

export function getPreview(
  node: PublicNode
): React.ComponentType<PreviewComponentProps> | null {
  return registry.find((e) => e.match(node))?.Component ?? null;
}

export function canPreview(node: PublicNode): boolean {
  return getPreview(node) !== null;
}
