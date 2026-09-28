import { type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/session";
import { diskPath, fileSizeOnDisk } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/nodes/[id]/content[?download=1]
 * Sert le contenu d'un fichier appartenant a l'utilisateur, avec support des
 * requetes Range (206 Partial Content) pour le seek video mp4 et le streaming.
 * Aucun fichier n'est accessible autrement que par cette route authentifiee.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return new Response("Non authentifie", { status: 401 });
  const { id } = await params;

  const node = await prisma.node.findFirst({
    where: { id, ownerId: user.userId, type: "FILE" },
  });
  if (!node || !node.storageKey) {
    return new Response("Fichier introuvable", { status: 404 });
  }

  let totalSize: bigint;
  try {
    totalSize = await fileSizeOnDisk(user.userId, node.storageKey);
  } catch {
    return new Response("Fichier introuvable sur le disque", { status: 404 });
  }
  const total = Number(totalSize);
  const path = diskPath(user.userId, node.storageKey);

  const contentType = node.mimeType || "application/octet-stream";
  const download = new URL(req.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const asciiName = encodeURIComponent(node.name);

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${asciiName}`,
    "Cache-Control": "private, no-store",
  };

  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      return new Response("Range invalide", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : total - 1;

    // Suffixe "bytes=-N" : les N derniers octets.
    if (!match[1] && match[2]) {
      start = Math.max(0, total - parseInt(match[2], 10));
      end = total - 1;
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      return new Response("Range non satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    end = Math.min(end, total - 1);
    const chunkSize = end - start + 1;

    const nodeStream = createReadStream(path, { start, end });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunkSize),
      },
    });
  }

  const nodeStream = createReadStream(path);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}
