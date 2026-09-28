import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";
import {
  deleteNodeRecursive,
  getOwnedNode,
  resolveFolder,
  toPublicNode,
  wouldCreateCycle,
} from "@/lib/nodes";
import { sanitizeName } from "@/lib/validation";

/**
 * PATCH /api/nodes/[id]  -> renommer et/ou deplacer
 * body: { name?: string, parentId?: string }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser(req, { mutating: true });
  if (isResponse(user)) return user;
  const { id } = await params;

  const node = await getOwnedNode(user.userId, id);
  if (!node) return error("Element introuvable", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Requete invalide", 400);
  }
  const b = body as Record<string, unknown>;

  const data: { name?: string; parentId?: string | null } = {};

  if (b.name !== undefined) {
    const name = sanitizeName(b.name);
    if (!name) return error("Nom invalide", 400);
    data.name = name;
  }

  if (b.parentId !== undefined) {
    const target = await resolveFolder(
      user.userId,
      typeof b.parentId === "string" ? b.parentId : "root"
    );
    if (!target) return error("Dossier cible introuvable", 404);
    // Empeche de deplacer un dossier dans lui-meme ou l'un de ses descendants.
    if (node.type === "FOLDER") {
      if (target.id === node.id) return error("Deplacement invalide", 400);
      if (await wouldCreateCycle(user.userId, node.id, target.id)) {
        return error("Impossible de deplacer un dossier dans lui-meme", 400);
      }
    }
    data.parentId = target.id;
  }

  if (Object.keys(data).length === 0) {
    return error("Aucune modification fournie", 400);
  }

  try {
    const updated = await prisma.node.update({ where: { id: node.id }, data });
    return json({ node: toPublicNode(updated) });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      return error("Un element porte deja ce nom dans le dossier cible", 409);
    }
    throw e;
  }
}

/** DELETE /api/nodes/[id]  -> suppression recursive (fichier ou dossier) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser(req, { mutating: true });
  if (isResponse(user)) return user;
  const { id } = await params;

  const node = await getOwnedNode(user.userId, id);
  if (!node) return error("Element introuvable", 404);

  await deleteNodeRecursive(user.userId, node.id);
  return json({ ok: true });
}
