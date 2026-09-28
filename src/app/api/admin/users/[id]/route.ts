import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, isResponse } from "@/lib/api";
import { deleteUserStorage } from "@/lib/storage";
import { revokeUserSessions } from "@/lib/session";
import { parseQuota } from "@/lib/validation";

const MIN_PASSWORD_LENGTH = 10;

/**
 * PATCH /api/admin/users/[id]
 * body: { password?, quotaGb?, isAdmin?, disableTwoFactor?, revokeSessions? }
 * Un changement de mot de passe ou une reinitialisation 2FA coupe toutes les
 * sessions ouvertes du compte ; revokeSessions le fait sans autre changement.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req, { mutating: true });
  if (isResponse(admin)) return admin;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return error("Compte introuvable", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Requete invalide", 400);
  }
  const b = body as Record<string, unknown>;

  const data: {
    passwordHash?: string;
    quotaBytes?: bigint;
    isAdmin?: boolean;
    totpSecret?: null;
  } = {};

  if (b.password !== undefined) {
    if (
      typeof b.password !== "string" ||
      b.password.length < MIN_PASSWORD_LENGTH
    ) {
      return error(
        `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caracteres`,
        400
      );
    }
    data.passwordHash = await bcrypt.hash(b.password, 12);
  }

  if (b.quotaGb !== undefined) {
    const quota = parseQuota(b.quotaGb);
    if (quota === null) return error("Quota invalide", 400);
    // Interdit un quota inferieur a la consommation actuelle.
    if (quota < target.usedBytes) {
      return error(
        "Le quota ne peut pas etre inferieur a l'espace deja utilise",
        400
      );
    }
    data.quotaBytes = quota;
  }

  if (b.isAdmin !== undefined) {
    const nextAdmin = b.isAdmin === true;
    // Empeche de se retirer soi-meme le role admin (risque de verrouillage).
    if (!nextAdmin && target.id === admin.userId) {
      return error("Vous ne pouvez pas retirer votre propre role admin", 400);
    }
    // Empeche de supprimer le dernier admin.
    if (!nextAdmin && target.isAdmin) {
      const adminCount = await prisma.user.count({ where: { isAdmin: true } });
      if (adminCount <= 1) {
        return error("Impossible de retirer le dernier administrateur", 400);
      }
    }
    data.isAdmin = nextAdmin;
  }

  if (b.disableTwoFactor === true) {
    data.totpSecret = null;
  }

  const revoke =
    b.revokeSessions === true ||
    data.passwordHash !== undefined ||
    data.totpSecret !== undefined;

  if (Object.keys(data).length === 0 && !revoke) {
    return error("Aucune modification fournie", 400);
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, isAdmin: true },
  });
  if (revoke) await revokeUserSessions(id);
  return json({ user: updated });
}

/** DELETE /api/admin/users/[id] -> supprime le compte et tous ses fichiers. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(req, { mutating: true });
  if (isResponse(admin)) return admin;
  const { id } = await params;

  if (id === admin.userId) {
    return error("Vous ne pouvez pas supprimer votre propre compte", 400);
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return error("Compte introuvable", 404);

  // Empeche de supprimer le dernier admin.
  if (target.isAdmin) {
    const adminCount = await prisma.user.count({ where: { isAdmin: true } });
    if (adminCount <= 1) {
      return error("Impossible de supprimer le dernier administrateur", 400);
    }
  }

  // Cascade DB (onDelete: Cascade sur Node) puis effacement disque. Un echec
  // disque ne remet pas en cause la suppression du compte : journalise, et
  // `npm run reconcile` retrouvera le dossier orphelin.
  await prisma.user.delete({ where: { id } });
  await deleteUserStorage(id).catch((err) => {
    console.error(
      `[web-storage] Stockage de l'utilisateur supprime ${id} non efface : lancer npm run reconcile.`,
      err
    );
  });

  return json({ ok: true });
}
