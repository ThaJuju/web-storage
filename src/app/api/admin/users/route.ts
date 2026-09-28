import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, isResponse } from "@/lib/api";
import { isValidEmail, parseQuota } from "@/lib/validation";

const MIN_PASSWORD_LENGTH = 10;
const DEFAULT_QUOTA_BYTES = 50_000_000_000n; // 50 Go

/** GET /api/admin/users -> liste des comptes avec usage + totaux. */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isResponse(admin)) return admin;

  const [users, fileCounts] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        usedBytes: true,
        quotaBytes: true,
        totpSecret: true,
        createdAt: true,
      },
    }),
    prisma.node.groupBy({
      by: ["ownerId"],
      where: { type: "FILE" },
      _count: { _all: true },
    }),
  ]);

  const countByOwner = new Map(
    fileCounts.map((f) => [f.ownerId, f._count._all])
  );

  const list = users.map((u) => ({
    id: u.id,
    email: u.email,
    isAdmin: u.isAdmin,
    twoFactor: !!u.totpSecret,
    usedBytes: u.usedBytes.toString(),
    quotaBytes: u.quotaBytes.toString(),
    fileCount: countByOwner.get(u.id) ?? 0,
    createdAt: u.createdAt.toISOString(),
    isSelf: u.id === admin.userId,
  }));

  const totalUsed = users.reduce((acc, u) => acc + u.usedBytes, 0n);

  return json({
    users: list,
    totals: {
      userCount: users.length,
      adminCount: users.filter((u) => u.isAdmin).length,
      usedBytes: totalUsed.toString(),
    },
  });
}

/**
 * POST /api/admin/users -> creation d'un compte.
 * body: { email, password, isAdmin?, quotaGb? }
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, { mutating: true });
  if (isResponse(admin)) return admin;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Requete invalide", 400);
  }
  const b = body as Record<string, unknown>;

  const email =
    typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return error("Adresse e-mail invalide", 400);

  if (typeof b.password !== "string" || b.password.length < MIN_PASSWORD_LENGTH) {
    return error(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caracteres`,
      400
    );
  }

  const quotaBytes = parseQuota(b.quotaGb) ?? DEFAULT_QUOTA_BYTES;
  const isAdmin = b.isAdmin === true;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return error("Un compte existe deja avec cet e-mail", 409);

  const passwordHash = await bcrypt.hash(b.password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, isAdmin, quotaBytes },
    select: { id: true, email: true, isAdmin: true },
  });

  return json({ user }, { status: 201 });
}
