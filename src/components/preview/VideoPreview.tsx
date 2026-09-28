"use client";

import type { PreviewComponentProps } from "./registry";

/**
 * Lecteur video integre. La source pointe vers la route content authentifiee
 * qui gere les requetes Range -> seek et streaming par chunks.
 */
export function VideoPreview({ src, node }: PreviewComponentProps) {
  return (
    <video
      key={node.id}
      src={src}
      controls
      autoPlay
      playsInline
      className="max-h-[75vh] w-full rounded-lg bg-black"
    >
      Votre navigateur ne peut pas lire cette vidéo.
    </video>
  );
}
