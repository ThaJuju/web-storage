import { prisma } from "./db";
import { deleteFromDisk } from "./storage";
import type { Prisma } from "@prisma/client";

/**
 * Coeur de la logique d'arborescence. TOUTE lecture/ecriture d'un node passe
 * par ces fonctions, qui contraignent systematiquement ownerId = celui de la
 * session -> pas d'acces aux ressources d'un autre utilisateur (IDOR).
 */

// Types partages avec le client : definis une seule fois dans types.ts.
import type { NodeType, PublicNode } from "./types";
export type { NodeType, PublicNode };

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

export const PAGE_SIZE = 500;

/**
 * Liste le contenu d'un dossier (parentId null = racine), par pages de
 * PAGE_SIZE. `cursor` = id du dernier element de la page precedente ; il
 * doit appartenir au meme dossier (sinon null : curseur invalide).
 */
export async function listChildren(
  ownerId: string,
  parentId: string | null,
  cursor?: string | null
): Promise<{ children: PublicNode[]; nextCursor: string | null } | null> {
  if (cursor) {
    const c = await prisma.node.findFirst({
      where: { id: cursor, ownerId, parentId },
      select: { id: true },
    });
    if (!c) return null;
  }
  const rows = await prisma.node.findMany({
    where: { ownerId, parentId },
    // Dossiers d'abord (FOLDER > FILE), puis nom ; id pour un ordre total.
    orderBy: [{ type: "desc" }, { name: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    children: page.map(toPublicNode),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Ancetres d'un node (lui compris), du plus proche au plus lointain, en une
 * seule requete (CTE recursive, profondeur bornee par garde-fou).
 */
async function ancestors(
  ownerId: string,
  nodeId: string
): Promise<{ id: string; name: string }[]> {
  return prisma.$queryRaw<{ id: string; name: string }[]>`
    WITH RECURSIVE anc("id", "name", "parentId", "depth") AS (
      SELECT "id", "name", "parentId", 0 FROM "Node"
      WHERE "id" = ${nodeId} AND "ownerId" = ${ownerId}
      UNION ALL
      SELECT n."id", n."name", n."parentId", anc."depth" + 1
      FROM "Node" n JOIN anc ON n."id" = anc."parentId"
      WHERE n."ownerId" = ${ownerId} AND anc."depth" < 1000
    )
    SELECT "id", "name" FROM anc ORDER BY "depth" ASC`;
}

/** Construit le fil d'ariane de la racine jusqu'au dossier donne. */
export async function breadcrumb(
  ownerId: string,
  folderId: string | null
): Promise<{ id: string; name: string }[]> {
  if (!folderId) return [];
  return (await ancestors(ownerId, folderId)).reverse();
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
  if (!targetParentId) return false;
  // Cycle si le node deplace est un ancetre (ou le dossier lui-meme) de la cible.
  return (await ancestors(ownerId, targetParentId)).some((a) => a.id === nodeId);
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
