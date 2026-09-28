import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import { error, json, checkOrigin } from "@/lib/api";
import { getLoginLockout, rateLimit, recordLogin } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation";
import { clientIp } from "@/lib/client-ip";
import {
  clearTwoFactorChallenge,
  createTwoFactorChallenge,
  verifySecondFactor,
} from "@/lib/two-factor";

/**
 * POST /api/auth/login  { email, password, totp? }
 * Etape 1 de la connexion. Si le compte a la 2FA et qu'aucun code n'est
 * fourni, ouvre une etape de verification cote serveur (cookie dedie) et
 * repond { requiresTwoFactor: true } : le code est ensuite envoye SEUL a
 * POST /api/auth/2fa (le mot de passe n'est pas renvoye). Un code peut
 * aussi etre fourni directement (seule facon de passer un blocage).
 */
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

  // Validation stricte cote serveur (longueur bornee : bcrypt est couteux).
  if (
    !isValidEmail(email) ||
    typeof password !== "string" ||
    !password ||
    password.length > 1024
  ) {
    return error("Identifiants invalides", 401);
  }

  // Code TOTP (6 chiffres) ou code de recuperation (XXXXX-XXXXX).
  const hasTotp =
    typeof totp === "string" && /^(\d{6}|[A-Za-z2-7]{5}-?[A-Za-z2-7]{5})$/.test(totp.trim());

  // Blocage progressif anti brute-force (par couple email+ip et par ip,
  // jamais par email seul) + ralentissement si le compte est vise en masse.
  const lock = await getLoginLockout(email, ip);
  if (lock.slowdownMs) await sleep(lock.slowdownMs);
  // Reponse identique que le compte ait la 2FA ou non : le client propose
  // alors un champ "code 2FA" (mot de passe + code valides passent).
  const lockedResponse = () =>
    json(
      {
        error: `Trop de tentatives. Reessayez dans ${Math.ceil(
          lock.retryAfterSec / 60
        )} min.`,
        totpBypass: true,
      },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSec) } }
    );
  // Sous blocage, on n'evalue le mot de passe que si un code 2FA est fourni
  // (et on repond 429 a l'identique en cas d'echec : pas d'oracle).
  if (lock.locked && !hasTotp) return lockedResponse();

  const user = await prisma.user.findUnique({ where: { email } });

  // Comparaison bcrypt meme si l'utilisateur n'existe pas (anti timing/enumeration).
  // Vrai hash bcrypt (d'une valeur factice) pour que le cout de comparaison
  // soit identique a celui d'un compte existant.
  const dummyHash =
    "$2b$12$Wzq0kkAXRfLnyoMqE1RgGu0z2M9noVgiFpSdIhASTbhXYiacphzwG";
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  if (lock.locked) {
    // Seule issue sous blocage : mot de passe ET 2FA valides.
    if (
      !user ||
      !ok ||
      !user.totpSecret ||
      !(await verifySecondFactor(user.id, totp as string))
    ) {
      return lockedResponse();
    }
  } else {
    if (!user || !ok) {
      await recordLogin({ userId: user?.id ?? null, email, ip, success: false });
      return error("Identifiants invalides", 401);
    }

    // --- 2FA TOTP (si activee sur le compte) ---
    if (user.totpSecret) {
      if (!hasTotp) {
        // Mot de passe correct, code a fournir : etape 2FA cote serveur (le
        // client n'aura pas a renvoyer le mot de passe).
        await createTwoFactorChallenge(user.id, ip);
        return json({ requiresTwoFactor: true }, { status: 200 });
      }
      if (!(await verifySecondFactor(user.id, totp as string))) {
        await recordLogin({ userId: user.id, email, ip, success: false });
        return error("Code de verification invalide", 401);
      }
    }
  }

  // Succes : ouverture d'une session serveur (le cookie ne porte que son id).
  await createSession(user.id);
  await clearTwoFactorChallenge();

  await recordLogin({ userId: user.id, email, ip, success: true });

  return json({ ok: true, isAdmin: user.isAdmin });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
