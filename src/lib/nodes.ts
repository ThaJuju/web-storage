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

/** Un fichier porte deja le nom du dossier a creer. */
export class FolderNameConflict extends Error {
  constructor(public folderName: string) {
    super(`Un fichier nomme "${folderName}" existe deja`);
  }
}

/**
 * Trouve (ou cree) un sous-dossier par nom sous un parent donne, pour un
 * meme proprietaire. Utilise lors de l'upload de dossiers. Si deux uploads
 * concurrents creent le meme dossier, la contrainte d'unicite leve P2002 :
 * l'appelant rejoue alors la transaction (withUniqueRetry), qui retrouve le
 * dossier cree entre-temps.
 */
export async function ensureSubfolder(
  tx: Prisma.TransactionClient,
  ownerId: string,
  parentId: string | null,
  name: string
): Promise<string> {
  const existing = await tx.node.findFirst({
    where: { ownerId, parentId, name },
    select: { id: true, type: true },
  });
  if (existing) {
    if (existing.type !== "FOLDER") throw new FolderNameConflict(name);
    return existing.id;
  }
  const created = await tx.node.create({
    data: { ownerId, parentId, name, type: "FOLDER" },
  });
  return created.id;
}

/**
 * Rejoue `fn` en cas de collision d'unicite (P2002) ou de conflit d'ecriture
 * SQLite (P2034) : deux ecritures concurrentes ont vise le meme nom. Le
 * nouvel essai relit l'etat a jour (dossier deja cree, nom deja pris...).
 */
export async function withUniqueRetry<T>(
  fn: () => Promise<T>,
  attempts = 5
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i >= attempts || (code !== "P2002" && code !== "P2034")) throw e;
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 20));
    }
  }
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
 * Supprime recursivement un node (et ses descendants pour un dossier) et
 * decremente le quota utilise, le tout dans UNE transaction :
 *  - la transaction commence par une ecriture sur l'utilisateur, ce qui
 *    prend le verrou d'ecriture SQLite : aucun upload concurrent ne peut
 *    s'inserer dans le sous-arbre entre le recensement et la suppression ;
 *  - les descendants sont recenses par une CTE recursive DANS la
 *    transaction, et le quota est decremente du total recalcule.
 * Les fichiers disque sont ensuite effaces hors transaction (best-effort) :
 * un echec est journalise sans faire echouer la requete, la base etant deja
 * coherente (les orphelins sont traites par `npm run reconcile`).
 */
export async function deleteNodeRecursive(
  ownerId: string,
  nodeId: string
): Promise<void> {
  const fileKeys = await withUniqueRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "User" SET "usedBytes" = "usedBytes" WHERE "id" = ${ownerId}`;

      const rows = await tx.$queryRaw<
        { type: string; size: bigint | number; storageKey: string | null }[]
      >`
        WITH RECURSIVE sub("id") AS (
          SELECT "id" FROM "Node" WHERE "id" = ${nodeId} AND "ownerId" = ${ownerId}
          UNION ALL
          SELECT n."id" FROM "Node" n JOIN sub ON n."parentId" = sub."id"
          WHERE n."ownerId" = ${ownerId}
        )
        SELECT n."type", n."size", n."storageKey"
        FROM "Node" n JOIN sub ON n."id" = sub."id"`;
      if (rows.length === 0) return [];

      const freedBytes = rows.reduce((acc, n) => acc + BigInt(n.size), 0n);

      // La contrainte onDelete: Cascade sur parentId efface tous les descendants.
      await tx.node.delete({ where: { id: nodeId } });
      if (freedBytes > 0n) {
        await tx.user.update({
          where: { id: ownerId },
          data: { usedBytes: { decrement: freedBytes } },
        });
      }
      return rows
        .filter((n) => n.type === "FILE" && n.storageKey)
        .map((n) => n.storageKey as string);
    })
  );

  const results = await Promise.allSettled(
    fileKeys.map((k) => deleteFromDisk(ownerId, k))
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(
      `[web-storage] ${failed} fichier(s) non efface(s) du disque apres suppression de ${nodeId} (utilisateur ${ownerId}) : lancer npm run reconcile.`
    );
  }
}
