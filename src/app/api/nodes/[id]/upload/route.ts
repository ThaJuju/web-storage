import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";
import { ensureSubfolder, resolveFolder, toPublicNode } from "@/lib/nodes";
import {
  MAX_UPLOAD_SIZE_BYTES,
  UploadLimitExceeded,
  deleteFromDisk,
  newStorageKey,
  writeStreamToDisk,
} from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeName, sanitizeRelativePath } from "@/lib/validation";
import { normalizeMimeType } from "@/lib/mime";

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

  // Rate-limit par utilisateur (rafale de 200 puis 10 fichiers/s : large pour
  // un upload de dossier, mais borne un script abusif).
  const rl = rateLimit(`upload:${user.userId}`, {
    capacity: 200,
    refillPerSec: 10,
  });
  if (!rl.allowed) {
    return error("Trop d'envois, reessayez plus tard.", 429, {
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  // Nombre d'uploads simultanes par utilisateur borne (le client les envoie
  // un par un ; au-dela, c'est un abus qui remplirait le disque en parallele).
  const running = activeUploads.get(user.userId) ?? 0;
  if (running >= MAX_CONCURRENT_UPLOADS) {
    return error("Trop d'envois simultanes, patientez.", 429, {
      headers: { "Retry-After": "5" },
    });
  }
  activeUploads.set(user.userId, running + 1);
  try {
    return await handleUpload(req, user.userId, id);
  } finally {
    const n = (activeUploads.get(user.userId) ?? 1) - 1;
    if (n <= 0) activeUploads.delete(user.userId);
    else activeUploads.set(user.userId, n);
  }
}

const MAX_CONCURRENT_UPLOADS = 3;
const activeUploads = new Map<string, number>();

async function handleUpload(
  req: NextRequest,
  userId: string,
  id: string
): Promise<Response> {

  const folder = await resolveFolder(userId, id);
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
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader !== null && !/^\d+$/.test(lengthHeader)) {
    return error("Content-Length invalide", 400);
  }
  const declared = lengthHeader !== null ? BigInt(lengthHeader) : null;
  if (declared !== null && declared > MAX_UPLOAD_SIZE_BYTES) {
    return error("Fichier trop volumineux", 413);
  }

  // Pre-controle du quota restant : on refuse avant d'ecrire le moindre octet.
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { usedBytes: true, quotaBytes: true },
  });
  if (!account) return error("Non authentifie", 401);
  const remaining = account.quotaBytes - account.usedBytes;
  if (remaining <= 0n || (declared !== null && declared > remaining)) {
    return error("Quota de stockage depasse", 413);
  }

  // Ecriture streamee sur disque, interrompue des que la limite effective
  // (taille max d'un fichier ou quota restant) est depassee.
  const quotaIsLimit = remaining < MAX_UPLOAD_SIZE_BYTES;
  const limit = quotaIsLimit ? remaining : MAX_UPLOAD_SIZE_BYTES;
  const storageKey = newStorageKey();
  let actualSize: bigint;
  try {
    actualSize = await writeStreamToDisk(
      userId,
      storageKey,
      req.body,
      limit
    );
  } catch (e) {
    if (e instanceof UploadLimitExceeded) {
      return error(
        quotaIsLimit ? "Quota de stockage depasse" : "Fichier trop volumineux",
        413
      );
    }
    return error("Echec de l'ecriture du fichier", 500);
  }
  // Garde-fou : ne jamais stocker en silence un fichier tronque (corps coupe
  // par un intermediaire, connexion interrompue...).
  if (declared !== null && actualSize !== declared) {
    await deleteFromDisk(userId, storageKey);
    return error("Fichier incomplet : taille recue differente de la taille annoncee", 400);
  }

  // Valide/normalise le type annonce (il ne sert jamais tel quel au rendu).
  const mimeType = normalizeMimeType(req.headers.get("content-type"));

  try {
    const node = await prisma.$transaction(async (tx) => {
      // Verifie le quota de facon atomique (relecture dans la transaction).
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { usedBytes: true, quotaBytes: true },
      });
      if (u.usedBytes + actualSize > u.quotaBytes) {
        throw new QuotaExceeded();
      }

      // Recree l'arborescence de dossiers (upload de dossier).
      let parentId = folder.id;
      for (const folderName of folders) {
        parentId = await ensureSubfolder(tx, userId, parentId, folderName);
      }

      // Nom libre (evite les collisions -> suffixe numerique).
      const finalName = await freeName(tx, userId, parentId, fileName!);

      const created = await tx.node.create({
        data: {
          ownerId: userId,
          parentId,
          type: "FILE",
          name: finalName,
          size: actualSize,
          mimeType,
          storageKey,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { usedBytes: { increment: actualSize } },
      });
      return created;
    });

    return json({ node: toPublicNode(node) }, { status: 201 });
  } catch (e) {
    // Rollback disque si la transaction echoue.
    await deleteFromDisk(userId, storageKey);
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
