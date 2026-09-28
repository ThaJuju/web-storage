import { type NextRequest } from "next/server";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/session";
import { diskPath } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * GET /api/nodes/[id]/zip
 * Genere a la volee un .zip du dossier (arborescence complete conservee) et
 * le streame au client, sans fichier temporaire. Ownership verifie a chaque
 * node parcouru.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return new Response("Non authentifie", { status: 401 });
  const { id } = await params;

  const root = await prisma.node.findFirst({
    where: { id, ownerId: user.userId, type: "FOLDER" },
  });
  if (!root) return new Response("Dossier introuvable", { status: 404 });

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.on("error", (err) => passthrough.destroy(err));
  archive.pipe(passthrough);

  // Construit l'archive en parcourant l'arbre (BFS), en conservant les chemins.
  (async () => {
    try {
      const queue: { nodeId: string; prefix: string }[] = [
        { nodeId: root.id, prefix: "" },
      ];
      while (queue.length) {
        const { nodeId, prefix } = queue.shift()!;
        const children = await prisma.node.findMany({
          where: { ownerId: user.userId, parentId: nodeId },
        });
        for (const child of children) {
          const entryPath = prefix ? `${prefix}/${child.name}` : child.name;
          if (child.type === "FOLDER") {
            // Dossier vide inclus explicitement pour preserver la structure.
            archive.append(Buffer.alloc(0), { name: `${entryPath}/` });
            queue.push({ nodeId: child.id, prefix: entryPath });
          } else if (child.storageKey) {
            archive.file(diskPath(user.userId, child.storageKey), {
              name: entryPath,
            });
          }
        }
      }
      await archive.finalize();
    } catch (err) {
      passthrough.destroy(err as Error);
    }
  })();

  const zipName = encodeURIComponent(`${root.name}.zip`);
  return new Response(
    Readable.toWeb(passthrough) as ReadableStream,
    {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${zipName}`,
        "Cache-Control": "private, no-store",
      },
    }
  );
}
