import { type NextRequest } from "next/server";
import archiver, { type Archiver } from "archiver";
import { createReadStream, type ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/session";
import { resolveFolder } from "@/lib/nodes";
import { diskPath } from "@/lib/storage";
import { USER_CONTENT_CSP } from "@/lib/mime";

export const runtime = "nodejs";
export const maxDuration = 600;

const ERRORS_ENTRY = "_ERREURS.txt";

/**
 * GET /api/nodes/[id]/zip   ([id] = dossier, "root" pour tout l'espace)
 * Genere a la volee un .zip du dossier (arborescence complete conservee) et
 * le streame au client, sans fichier temporaire. Ownership verifie a chaque
 * node parcouru.
 *  - Un fichier reference en base mais absent du disque est ignore et liste
 *    dans _ERREURS.txt a la racine de l'archive (au lieu de tronquer le zip
 *    alors que le statut 200 est deja parti).
 *  - Si le client annule le telechargement, le parcours et la compression
 *    s'arretent immediatement.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return new Response("Non authentifie", { status: 401 });
  const { id } = await params;

  const folder = await resolveFolder(user.userId, id);
  if (!folder) return new Response("Dossier introuvable", { status: 404 });
  const rootName = folder.id
    ? (await prisma.node.findUniqueOrThrow({ where: { id: folder.id } })).name
    : "Mes fichiers";

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.on("error", (err) => passthrough.destroy(err));
  archive.pipe(passthrough);

  // Annulation cote client : on arrete le parcours, l'archiveur, et on ferme
  // le fichier en cours de lecture (archive.abort() seul le laisse ouvert).
  let aborted = false;
  let current: ReadStream | null = null;
  let resolveAborted: () => void = () => {};
  const abortedPromise = new Promise<void>((r) => (resolveAborted = r));
  const onAbort = () => {
    aborted = true;
    current?.destroy();
    archive.abort();
    passthrough.destroy();
    resolveAborted();
  };
  if (req.signal.aborted) onAbort();
  else req.signal.addEventListener("abort", onAbort, { once: true });

  // Construit l'archive en parcourant l'arbre (BFS), en conservant les chemins.
  (async () => {
    const errors: string[] = [];
    const usedPaths = new Set<string>([ERRORS_ENTRY]);
    // Garde-fou : deux entrees de meme chemin rendraient l'archive ambigue.
    const uniquePath = (p: string) => {
      let candidate = p;
      for (let i = 1; usedPaths.has(candidate); i++) candidate = `${p} (${i})`;
      usedPaths.add(candidate);
      return candidate;
    };

    try {
      const queue: { parentId: string | null; prefix: string }[] = [
        { parentId: folder.id, prefix: "" },
      ];
      while (queue.length && !aborted) {
        const { parentId, prefix } = queue.shift()!;
        const children = await prisma.node.findMany({
          where: { ownerId: user.userId, parentId },
          orderBy: { name: "asc" },
        });
        for (const child of children) {
          if (aborted) break;
          const entryPath = uniquePath(
            prefix ? `${prefix}/${child.name}` : child.name
          );
          if (child.type === "FOLDER") {
            // Dossier vide inclus explicitement pour preserver la structure.
            await Promise.race([
              appendEntry(archive, Buffer.alloc(0), `${entryPath}/`),
              abortedPromise,
            ]);
            queue.push({ parentId: child.id, prefix: entryPath });
          } else if (child.storageKey) {
            const file = diskPath(user.userId, child.storageKey);
            const exists = await stat(file).then(
              (s) => s.isFile(),
              () => false
            );
            if (exists) {
              // Un seul fichier ouvert a la fois : on attend qu'il soit
              // entierement archive avant de passer au suivant.
              current = createReadStream(file);
              await Promise.race([
                appendEntry(archive, current, entryPath),
                abortedPromise,
              ]);
              current = null;
            } else {
              errors.push(`${entryPath} : fichier introuvable sur le serveur`);
            }
          }
        }
      }
      if (aborted) return;
      if (errors.length) {
        archive.append(
          `Les fichiers suivants n'ont pas pu etre inclus dans l'archive :\n\n${errors.join("\n")}\n`,
          { name: ERRORS_ENTRY }
        );
      }
      await archive.finalize();
    } catch (err) {
      passthrough.destroy(err as Error);
    } finally {
      req.signal.removeEventListener("abort", onAbort);
    }
  })();

  const zipName = encodeURIComponent(`${rootName}.zip`);
  return new Response(
    Readable.toWeb(passthrough) as ReadableStream,
    {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${zipName}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": USER_CONTENT_CSP,
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

/** Ajoute une entree et attend que l'archiveur l'ait entierement traitee. */
function appendEntry(
  archive: Archiver,
  source: Buffer | ReadStream,
  name: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: { name: string }) => {
      if (entry.name !== name) return;
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
    };
    archive.on("entry", onEntry);
    archive.on("error", onError);
    archive.append(source, { name });
  });
}
