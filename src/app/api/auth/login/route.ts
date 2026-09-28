import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import { error, json, checkOrigin } from "@/lib/api";
import { getLoginLockout, rateLimit } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  // Anti-CSRF : origine obligatoire sur cette mutation.
  if (!checkOrigin(req)) return error("Origine invalide", 403);

  const ip = clientIp(req);

  // Rate limiting grossier par IP (indep. du succes) : 10 req / min.
  const rl = rateLimit(`login:${ip}`, { capacity: 10, refillPerSec: 10 / 60 });
  if (!rl.allowed) {
    return error("Trop de requetes, reessayez plus tard.", 429, {
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Requete invalide", 400);
  }
  const email =
    typeof (body as Record<string, unknown>)?.email === "string"
      ? ((body as Record<string, string>).email).trim().toLowerCase()
      : "";
  const password = (body as Record<string, unknown>)?.password;
  const totp = (body as Record<string, unknown>)?.totp;

  // Validation stricte cote serveur.
  if (!isValidEmail(email) || typeof password !== "string" || !password) {
    return error("Identifiants invalides", 401);
  }

  // Blocage progressif anti brute-force.
  const lock = await getLoginLockout(email, ip);
  if (lock.locked) {
    return error(
      `Trop de tentatives. Reessayez dans ${Math.ceil(
        lock.retryAfterSec / 60
      )} min.`,
      429,
      { headers: { "Retry-After": String(lock.retryAfterSec) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Comparaison bcrypt meme si l'utilisateur n'existe pas (anti timing/enumeration).
  // Vrai hash bcrypt (d'une valeur factice) pour que le cout de comparaison
  // soit identique a celui d'un compte existant.
  const dummyHash =
    "$2b$12$Wzq0kkAXRfLnyoMqE1RgGu0z2M9noVgiFpSdIhASTbhXYiacphzwG";
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  if (!user || !ok) {
    await prisma.loginLog.create({
      data: { userId: user?.id ?? null, email, ip, success: false },
    });
    return error("Identifiants invalides", 401);
  }

  // --- 2FA TOTP (si activee sur le compte) ---
  if (user.totpSecret) {
    if (typeof totp !== "string" || !/^\d{6}$/.test(totp)) {
      // Mot de passe correct mais code manquant/mal forme : on demande la 2FA
      // sans encore ouvrir la session complete.
      return json({ requiresTwoFactor: true }, { status: 200 });
    }
    const { verifyTotp } = await import("@/lib/totp");
    if (!verifyTotp(user.totpSecret, totp)) {
      await prisma.loginLog.create({
        data: { userId: user.id, email, ip, success: false },
      });
      return error("Code de verification invalide", 401);
    }
  }

  // Succes : ouverture d'une session serveur (le cookie ne porte que son id).
  await createSession(user.id);

  await prisma.loginLog.create({
    data: { userId: user.id, email, ip, success: true },
  });

  return json({ ok: true, isAdmin: user.isAdmin });
}
