import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";
import {
  breadcrumb,
  listChildren,
  resolveFolder,
  searchNodes,
  toPublicNode,
} from "@/lib/nodes";
import { sanitizeName } from "@/lib/validation";

/**
 * GET /api/nodes?folder=<id>[&cursor=<id>] -> contenu d'un dossier (pagine,
 *                                cf. nextCursor) + fil d'ariane
 * GET /api/nodes?q=<query>     -> recherche par nom
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (q !== null) {
    const results = await searchNodes(user.userId, q);
    return json({ results });
  }

  const folderParam = searchParams.get("folder") ?? "root";
  const folder = await resolveFolder(user.userId, folderParam);
  if (!folder) return error("Dossier introuvable", 404);

  const [page, crumbs] = await Promise.all([
    listChildren(user.userId, folder.id, searchParams.get("cursor")),
    breadcrumb(user.userId, folder.id),
  ]);
  if (!page) return error("Curseur invalide", 400);
  return json({
    folderId: folder.id ?? "root",
    breadcrumb: crumbs,
    children: page.children,
    nextCursor: page.nextCursor,
  });
}

/**
 * POST /api/nodes   -> creation d'un dossier
 * body: { parentId: string, name: string }
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req, { mutating: true });
  if (isResponse(user)) return user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Requete invalide", 400);
  }
  const b = body as Record<string, unknown>;
  const name = sanitizeName(b.name);
  if (!name) return error("Nom de dossier invalide", 400);

  const parent = await resolveFolder(
    user.userId,
    typeof b.parentId === "string" ? b.parentId : "root"
  );
  if (!parent) return error("Dossier parent introuvable", 404);

  try {
    const created = await prisma.node.create({
      data: {
        ownerId: user.userId,
        parentId: parent.id,
        type: "FOLDER",
        name,
      },
    });
    return json({ node: toPublicNode(created) }, { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      return error("Un element porte deja ce nom dans ce dossier", 409);
    }
    throw e;
  }
}
