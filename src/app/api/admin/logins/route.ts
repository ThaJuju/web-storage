import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireUser, isResponse } from "@/lib/api";

/** GET /api/admin/logins -> journal des connexions (admin uniquement). */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  if (!user.isAdmin) return error("Acces refuse", 403);

  const logs = await prisma.loginLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      email: true,
      ip: true,
      success: true,
      createdAt: true,
    },
  });

  return json({
    logs: logs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })),
  });
}
