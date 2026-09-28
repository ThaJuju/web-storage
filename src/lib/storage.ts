import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Racine de stockage, resolue une fois. JAMAIS dans public/.
const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

export const MAX_UPLOAD_SIZE_BYTES = BigInt(
  process.env.MAX_UPLOAD_SIZE_BYTES ?? "4294967296"
);

/**
 * Chemin disque d'un fichier a partir de son storageKey (UUID) et de son
 * proprietaire. Structure : <root>/<userId>/<2 premiers chars>/<uuid>.
 * Aucun nom fourni par l'utilisateur n'entre ici -> path traversal impossible.
 */
export function diskPath(ownerId: string, storageKey: string): string {
  const shard = storageKey.slice(0, 2);
  const resolved = path.join(STORAGE_ROOT, ownerId, shard, storageKey);
  // Ceinture et bretelles : on verifie que le chemin reste sous la racine.
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Chemin de stockage invalide");
  }
  return resolved;
}

export function newStorageKey(): string {
  return randomUUID();
}

/**
 * Ecrit un flux entrant sur disque en streaming (jamais bufferise en RAM).
 * Renvoie la taille reelle ecrite. Le respect du quota est verifie par
 * l'appelant AVANT (borne max) et APRES (taille exacte) via une transaction DB.
 */
export async function writeStreamToDisk(
  ownerId: string,
  storageKey: string,
  stream: ReadableStream<Uint8Array>
): Promise<bigint> {
  const dest = diskPath(ownerId, storageKey);
  await mkdir(path.dirname(dest), { recursive: true });

  let written = 0n;
  const nodeStream = Readable.fromWeb(stream as never);
  const out = createWriteStream(dest);

  nodeStream.on("data", (chunk: Buffer) => {
    written += BigInt(chunk.length);
  });

  try {
    await pipeline(nodeStream, out);
  } catch (err) {
    // Nettoyage best-effort en cas d'echec d'ecriture.
    await unlink(dest).catch(() => {});
    throw err;
  }
  return written;
}

export async function deleteFromDisk(
  ownerId: string,
  storageKey: string
): Promise<void> {
  await unlink(diskPath(ownerId, storageKey)).catch((err) => {
    // Un fichier deja absent ne doit pas bloquer la suppression logique.
    if (err?.code !== "ENOENT") throw err;
  });
}

export async function fileSizeOnDisk(
  ownerId: string,
  storageKey: string
): Promise<bigint> {
  const s = await stat(diskPath(ownerId, storageKey));
  return BigInt(s.size);
}

/**
 * Supprime tout le repertoire de stockage d'un utilisateur (tous ses fichiers).
 * Utilise a la suppression d'un compte. L'id est valide (contrainte de chemin).
 */
export async function deleteUserStorage(ownerId: string): Promise<void> {
  const dir = path.join(STORAGE_ROOT, ownerId);
  if (!dir.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Chemin de stockage invalide");
  }
  await rm(dir, { recursive: true, force: true });
}
