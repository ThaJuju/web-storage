import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";

/** GET /api/usage -> consommation et quota de l'utilisateur courant. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const u = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { usedBytes: true, quotaBytes: true },
  });
  if (!u) return error("Utilisateur introuvable", 404);

  return json({
    usedBytes: u.usedBytes.toString(),
    quotaBytes: u.quotaBytes.toString(),
  });
}
