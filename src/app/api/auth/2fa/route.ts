import { type NextRequest } from "next/server";
import { checkOrigin, error, json } from "@/lib/api";
import { clientIp } from "@/lib/client-ip";
import { rateLimit, recordLogin } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import {
  CHALLENGE_MAX_ATTEMPTS,
  clearTwoFactorChallenge,
  getTwoFactorChallenge,
  recordChallengeFailure,
  verifySecondFactor,
} from "@/lib/two-factor";

/**
 * POST /api/auth/2fa  { code }
 * Etape 2 de la connexion : le mot de passe a deja ete verifie par
 * /api/auth/login, qui a ouvert une etape de verification cote serveur
 * (cookie dedie, 5 min, 5 essais). `code` = TOTP a 6 chiffres (usage unique)
 * ou code de recuperation.
 */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return error("Origine invalide", 403);
  const ip = clientIp(req);

  const rl = rateLimit(`2fa:${ip}`, { capacity: 10, refillPerSec: 10 / 60 });
  if (!rl.allowed) {
    return error("Trop de requetes, reessayez plus tard.", 429, {
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  const challenge = await getTwoFactorChallenge();
  if (!challenge) {
    return json(
      { error: "Verification expiree, reconnectez-vous.", restart: true },
      { status: 401 }
    );
  }
  if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
    await clearTwoFactorChallenge(challenge.id);
    return json(
      { error: "Trop d'essais, reconnectez-vous.", restart: true },
      { status: 429 }
    );
  }

  let code: unknown;
  try {
    code = ((await req.json()) as Record<string, unknown>)?.code;
  } catch {
    return error("Requete invalide", 400);
  }
  const email = challenge.user.email;

  if (typeof code !== "string" || !(await verifySecondFactor(challenge.userId, code))) {
    await recordChallengeFailure(challenge.id);
    await recordLogin({ userId: challenge.userId, email, ip, success: false });
    return error("Code de verification invalide", 401);
  }

  await clearTwoFactorChallenge(challenge.id);
  await createSession(challenge.userId);
  await recordLogin({ userId: challenge.userId, email, ip, success: true });
  return json({ ok: true });
}
