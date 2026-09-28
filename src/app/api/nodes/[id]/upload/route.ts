import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";
import { ensureSubfolder, resolveFolder, toPublicNode } from "@/lib/nodes";
import {
  MAX_UPLOAD_SIZE_BYTES,
  deleteFromDisk,
  newStorageKey,
  writeStreamToDisk,
} from "@/lib/storage";
import { sanitizeName, sanitizeRelativePath } from "@/lib/validation";

// On veut le runtime Node (streams fichiers, pas Edge).
export const runtime = "nodejs";
// Corps volumineux : pas de parsing automatique.
export const maxDuration = 600;

/**
 * POST /api/nodes/[id]/upload
 * [id] = dossier cible ("root" pour la racine).
 * Corps de la requete = OCTETS BRUTS du fichier (un fichier par requete ->
 * streaming direct sur disque + barre de progression cote client via XHR).
 * En-tetes :
 *   x-file-name : nom original (encode URI)
 *   x-rel-path  : chemin relatif optionnel (upload de dossier, encode URI)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser(req, { mutating: true });
  if (isResponse(user)) return user;
  const { id } = await params;

  const folder = await resolveFolder(user.userId, id);
  if (!folder) return error("Dossier cible introuvable", 404);

  // Determine le nom du fichier et l'arborescence a recreer.
  const relPathHeader = safeDecode(req.headers.get("x-rel-path"));
  let fileName: string | null;
  let folders: string[] = [];

  if (relPathHeader) {
    const parsed = sanitizeRelativePath(relPathHeader);
    if (!parsed) return error("Chemin de fichier invalide", 400);
    fileName = parsed.fileName;
    folders = parsed.folders;
  } else {
    fileName = sanitizeName(safeDecode(req.headers.get("x-file-name")));
  }
  if (!fileName) return error("Nom de fichier invalide", 400);

  if (!req.body) return error("Corps de requete vide", 400);

  // Pre-controle de taille via Content-Length (borne, pas source de verite).
  const declared = BigInt(req.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_SIZE_BYTES) {
    return error("Fichier trop volumineux", 413);
  }

  // Ecriture streamee sur disque ; on connait ensuite la taille exacte.
  const storageKey = newStorageKey();
  let actualSize: bigint;
  try {
    actualSize = await writeStreamToDisk(user.userId, storageKey, req.body);
  } catch {
    return error("Echec de l'ecriture du fichier", 500);
  }

  if (actualSize > MAX_UPLOAD_SIZE_BYTES) {
    await deleteFromDisk(user.userId, storageKey);
    return error("Fichier trop volumineux", 413);
  }

  const mimeType = req.headers.get("content-type") || null;

  try {
    const node = await prisma.$transaction(async (tx) => {
      // Verifie le quota de facon atomique (relecture dans la transaction).
      const u = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { usedBytes: true, quotaBytes: true },
      });
      if (u.usedBytes + actualSize > u.quotaBytes) {
        throw new QuotaExceeded();
      }

      // Recree l'arborescence de dossiers (upload de dossier).
      let parentId = folder.id;
      for (const folderName of folders) {
        parentId = await ensureSubfolder(tx, user.userId, parentId, folderName);
      }

      // Nom libre (evite les collisions -> suffixe numerique).
      const finalName = await freeName(tx, user.userId, parentId, fileName!);

      const created = await tx.node.create({
        data: {
          ownerId: user.userId,
          parentId,
          type: "FILE",
          name: finalName,
          size: actualSize,
          mimeType,
          storageKey,
        },
      });
      await tx.user.update({
        where: { id: user.userId },
        data: { usedBytes: { increment: actualSize } },
      });
      return created;
    });

    return json({ node: toPublicNode(node) }, { status: 201 });
  } catch (e) {
    // Rollback disque si la transaction echoue.
    await deleteFromDisk(user.userId, storageKey);
    if (e instanceof QuotaExceeded) {
      return error("Quota de stockage depasse", 413);
    }
    throw e;
  }
}

class QuotaExceeded extends Error {}

/** decodeURIComponent qui renvoie null (-> 400) au lieu de throw (-> 500). */
function safeDecode(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Trouve un nom libre dans un dossier en suffixant " (n)" si necessaire. */
async function freeName(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ownerId: string,
  parentId: string | null,
  name: string
): Promise<string> {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? name : `${base} (${i})${ext}`;
    const clash = await tx.node.findFirst({
      where: { ownerId, parentId, name: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
