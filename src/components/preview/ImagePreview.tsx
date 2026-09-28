"use client";

import type { PreviewComponentProps } from "./registry";

/** Apercu image (illustre l'extensibilite du registre de previews). */
export function ImagePreview({ src, node }: PreviewComponentProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={node.name}
      className="mx-auto max-h-[75vh] w-auto rounded-lg object-contain"
    />
  );
}
