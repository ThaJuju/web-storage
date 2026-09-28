import { prisma } from "./db";
import { deleteFromDisk } from "./storage";
import type { Prisma } from "@prisma/client";

/**
 * Coeur de la logique d'arborescence. TOUTE lecture/ecriture d'un node passe
 * par ces fonctions, qui contraignent systematiquement ownerId = celui de la
 * session -> pas d'acces aux ressources d'un autre utilisateur (IDOR).
 */

export type NodeType = "FILE" | "FOLDER";

export interface PublicNode {
  id: string;
  name: string;
  type: NodeType;
  size: string; // BigInt serialise en string pour le JSON
  mimeType: string | null;
  parentId: string | null;
  updatedAt: string;
}

export function toPublicNode(n: {
  id: string;
  name: string;
  type: string;
  size: bigint;
  mimeType: string | null;
  parentId: string | null;
  updatedAt: Date;
}): PublicNode {
  return {
    id: n.id,
    name: n.name,
    type: n.type as NodeType,
    size: n.size.toString(),
    mimeType: n.mimeType,
    parentId: n.parentId,
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** Recupere un node en garantissant qu'il appartient a l'utilisateur. */
export async function getOwnedNode(ownerId: string, nodeId: string) {
  return prisma.node.findFirst({ where: { id: nodeId, ownerId } });
}

/**
 * Resout un id de dossier. La racine virtuelle de l'utilisateur est
 * representee par l'id "root" -> parentId null. Renvoie null si l'id ne
 * correspond pas a un dossier possede.
 */
export async function resolveFolder(
  ownerId: string,
  folderId: string
): Promise<{ id: string | null } | null> {
  if (folderId === "root") return { id: null };
  const node = await prisma.node.findFirst({
    where: { id: folderId, ownerId, type: "FOLDER" },
  });
  return node ? { id: node.id } : null;
}

/** Liste le contenu d'un dossier (parentId null = racine). */
export async function listChildren(ownerId: string, parentId: string | null) {
  const rows = await prisma.node.findMany({
    where: { ownerId, parentId },
    orderBy: [{ type: "desc" }, { name: "asc" }], // dossiers d'abord (FOLDER > FILE)
  });
  return rows.map(toPublicNode);
}

/** Construit le fil d'ariane de la racine jusqu'au dossier donne. */
export async function breadcrumb(
  ownerId: string,
  folderId: string | null
): Promise<{ id: string; name: string }[]> {
  const crumbs: { id: string; name: string }[] = [];
  let current = folderId;
  // Garde-fou anti-boucle (structure normalement acyclique).
  for (let i = 0; current && i < 1000; i++) {
    const node = await prisma.node.findFirst({
      where: { id: current, ownerId },
      select: { id: true, name: true, parentId: true },
    });
    if (!node) break;
    crumbs.unshift({ id: node.id, name: node.name });
    current = node.parentId;
  }
  return crumbs;
}

/** Recherche par nom (insensible a la casse) sur tout l'espace de l'utilisateur. */
export async function searchNodes(ownerId: string, query: string) {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.node.findMany({
    where: { ownerId, name: { contains: q } },
    orderBy: [{ type: "desc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map(toPublicNode);
}

/**
 * Trouve (ou cree) un sous-dossier par nom sous un parent donne, pour un
 * meme proprietaire. Utilise lors de l'upload de dossiers.
 */
export async function ensureSubfolder(
  tx: Prisma.TransactionClient,
  ownerId: string,
  parentId: string | null,
  name: string
): Promise<string> {
  const existing = await tx.node.findFirst({
    where: { ownerId, parentId, name, type: "FOLDER" },
  });
  if (existing) return existing.id;
  const created = await tx.node.create({
    data: { ownerId, parentId, name, type: "FOLDER" },
  });
  return created.id;
}

/**
 * Verifie qu'un deplacement de `nodeId` vers `targetParentId` ne cree pas de
 * cycle (deplacer un dossier dans l'un de ses propres descendants).
 */
export async function wouldCreateCycle(
  ownerId: string,
  nodeId: string,
  targetParentId: string | null
): Promise<boolean> {
  let current = targetParentId;
  for (let i = 0; current && i < 1000; i++) {
    if (current === nodeId) return true;
    const parent = await prisma.node.findFirst({
      where: { id: current, ownerId },
      select: { parentId: true },
    });
    if (!parent) break;
    current = parent.parentId;
  }
  return false;
}

/**
 * Supprime recursivement un node (et ses descendants pour un dossier),
 * efface les fichiers du disque et decremente le quota utilise, le tout dans
 * une transaction.
 */
export async function deleteNodeRecursive(
  ownerId: string,
  nodeId: string
): Promise<void> {
  // Rassemble tous les descendants + le node lui-meme (parcours iteratif).
  const toVisit = [nodeId];
  const allNodes: {
    id: string;
    type: string;
    size: bigint;
    storageKey: string | null;
  }[] = [];

  while (toVisit.length) {
    const batch = toVisit.splice(0, 200);
    const children = await prisma.node.findMany({
      where: { ownerId, parentId: { in: batch } },
      select: { id: true, type: true, size: true, storageKey: true },
    });
    for (const c of children) {
      allNodes.push(c);
      if (c.type === "FOLDER") toVisit.push(c.id);
    }
  }
  const self = await prisma.node.findFirst({
    where: { id: nodeId, ownerId },
    select: { id: true, type: true, size: true, storageKey: true },
  });
  if (!self) return;
  allNodes.push(self);

  const freedBytes = allNodes.reduce((acc, n) => acc + n.size, 0n);
  const fileKeys = allNodes
    .filter((n) => n.type === "FILE" && n.storageKey)
    .map((n) => n.storageKey!) as string[];

  await prisma.$transaction(async (tx) => {
    // La contrainte onDelete: Cascade sur parentId efface tous les descendants.
    await tx.node.delete({ where: { id: nodeId } });
    if (freedBytes > 0n) {
      await tx.user.update({
        where: { id: ownerId },
        data: { usedBytes: { decrement: freedBytes } },
      });
    }
  });

  // Effacement disque hors transaction (best-effort) : la DB est deja coherente.
  await Promise.all(fileKeys.map((k) => deleteFromDisk(ownerId, k)));
}
