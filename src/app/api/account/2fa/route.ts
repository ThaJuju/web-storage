import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { error, isResponse, json, requireUser } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { revokeOtherSessions } from "@/lib/session";
import {
  TWO_FACTOR_DISABLED,
  confirmEnrollment,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  startEnrollment,
  verifySecondFactor,
} from "@/lib/two-factor";

/** GET /api/account/2fa -> etat de la 2FA du compte courant. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: user.userId },
    select: { totpSecret: true, totpRecoveryCodes: true },
  });
  return json({
    enabled: !!u.totpSecret,
    recoveryCodesLeft: recoveryCodesLeft(u.totpRecoveryCodes),
  });
}

/**
 * POST /api/account/2fa
 *  { action: "setup" }                    -> { uri, secret, qr } (secret en attente)
 *  { action: "enable", code }             -> { recoveryCodes }  (active la 2FA)
 *  { action: "regenerate", code }         -> { recoveryCodes }
 *  { action: "disable", password, code }  -> { ok }
 * Activer ou desactiver la 2FA deconnecte les autres sessions du compte.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req, { mutating: true });
  if (isResponse(user)) return user;

  // Borne les essais de code (enable / regenerate / disable).
  const rl = rateLimit(`account-2fa:${user.userId}`, {
    capacity: 10,
    refillPerSec: 10 / 300,
  });
  if (!rl.allowed) {
    return error("Trop de tentatives, reessayez plus tard.", 429, {
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error("Requete invalide", 400);
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.userId },
    select: { email: true, passwordHash: true, totpSecret: true },
  });

  switch (body.action) {
    case "setup": {
      if (account.totpSecret) return error("La 2FA est deja activee", 409);
      const { uri, secret } = await startEnrollment(user.userId, account.email);
      const svg = await QRCode.toString(uri, { type: "svg", margin: 1 });
      const qr = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      return json({ uri, secret, qr });
    }
    case "enable": {
      if (account.totpSecret) return error("La 2FA est deja activee", 409);
      const recoveryCodes = await confirmEnrollment(user.userId, code);
      if (!recoveryCodes) return error("Code invalide", 400);
      await revokeOtherSessions(user.userId);
      return json({ recoveryCodes });
    }
    case "regenerate": {
      if (!account.totpSecret) return error("La 2FA n'est pas activee", 409);
      if (!(await verifySecondFactor(user.userId, code))) {
        return error("Code invalide", 400);
      }
      return json({ recoveryCodes: await regenerateRecoveryCodes(user.userId) });
    }
    case "disable": {
      if (!account.totpSecret) return error("La 2FA n'est pas activee", 409);
      const password = typeof body.password === "string" ? body.password : "";
      const okPassword =
        password.length <= 1024 &&
        (await bcrypt.compare(password, account.passwordHash));
      if (!okPassword || !(await verifySecondFactor(user.userId, code))) {
        return error("Mot de passe ou code invalide", 400);
      }
      await prisma.user.update({
        where: { id: user.userId },
        data: TWO_FACTOR_DISABLED,
      });
      await revokeOtherSessions(user.userId);
      return json({ ok: true });
    }
    default:
      return error("Action inconnue", 400);
  }
}
