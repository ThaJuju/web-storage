export type NodeType = "FILE" | "FOLDER";

export interface PublicNode {
  id: string;
  name: string;
  type: NodeType;
  size: string;
  mimeType: string | null;
  parentId: string | null;
  updatedAt: string;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface FolderListing {
  folderId: string;
  breadcrumb: Crumb[];
  children: PublicNode[];
  // Curseur de la page suivante (null : dossier entierement charge).
  nextCursor: string | null;
}
