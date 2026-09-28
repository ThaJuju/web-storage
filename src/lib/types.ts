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
}
