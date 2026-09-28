import { createHash, randomBytes } from "node:crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sessionOptions } from "./session";
import { generateTotpSecret, matchTotp, totpAuthUri } from "./totp";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from "./totp-crypto";

/**
 * Logique 2FA : verification anti-rejeu, codes de recuperation, etape de
 * connexion cote serveur (challenge) et enrolement.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// --- Verification d'un second facteur -------------------------------------

const RECOVERY_RE = /^[A-Z2-7]{5}-?[A-Z2-7]{5}$/;

/**
 * Verifie un second facteur pour l'utilisateur : code TOTP a 6 chiffres
 * (refuse s'il a deja servi, meme dans sa fenetre de validite) ou code de
 * recuperation (consomme). Re-chiffre au passage un secret historique stocke
 * en clair.
 */
export async function verifySecondFactor(
  userId: string,
  input: string
): Promise<boolean> {
  const code = input.trim().toUpperCase();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpSecret: true,
      totpLastCounter: true,
      totpRecoveryCodes: true,
    },
  });
  if (!user?.totpSecret) return false;

  if (/^\d{6}$/.test(code)) {
    const secret = decryptTotpSecret(user.totpSecret);
    const counter = matchTotp(secret, code);
    if (counter === null) return false;
    // Anti-rejeu atomique : n'accepte que si le compteur progresse.
    const { count } = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: counter } }],
      },
      data: {
        totpLastCounter: counter,
        ...(isEncryptedTotpSecret(user.totpSecret)
          ? {}
          : { totpSecret: encryptTotpSecret(secret) }),
      },
    });
    return count === 1;
  }

  if (RECOVERY_RE.test(code)) {
    return consumeRecoveryCode(userId, code, user.totpRecoveryCodes);
  }
  return false;
}

async function consumeRecoveryCode(
  userId: string,
  code: string,
  stored: string | null
): Promise<boolean> {
  if (!stored) return false;
  const hashes: string[] = JSON.parse(stored);
  const h = sha256(code.replace("-", ""));
  if (!hashes.includes(h)) return false;
  // Mise a jour conditionnelle : deux utilisations simultanees du meme code
  // ne peuvent pas reussir toutes les deux.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpRecoveryCodes: stored },
    data: { totpRecoveryCodes: JSON.stringify(hashes.filter((x) => x !== h)) },
  });
  return count === 1;
}

/** Genere 10 codes de recuperation ; seules leurs empreintes sont stockees. */
function newRecoveryCodes(): { codes: string[]; stored: string } {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const codes = Array.from({ length: 10 }, () => {
    const bytes = randomBytes(10);
    const raw = Array.from(bytes, (b) => alphabet[b & 31]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return {
    codes,
    stored: JSON.stringify(codes.map((c) => sha256(c.replace("-", "")))),
  };
}

export function recoveryCodesLeft(stored: string | null): number {
  return stored ? (JSON.parse(stored) as string[]).length : 0;
}

// --- Etape 2FA de la connexion (etat serveur) -----------------------------

const CHALLENGE_COOKIE = "webstorage_2fa";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_MAX_ATTEMPTS = 5;

async function challengeCookie() {
  return getIronSession<{ cid?: string }>(await cookies(), {
    ...sessionOptions(),
    cookieName: CHALLENGE_COOKIE,
    cookieOptions: {
      ...sessionOptions().cookieOptions,
      maxAge: CHALLENGE_TTL_MS / 1000,
    },
  });
}

/** Mot de passe valide, 2FA requise : ouvre une etape de verification. */
export async function createTwoFactorChallenge(userId: string, ip: string) {
  const now = Date.now();
  await prisma.twoFactorChallenge.deleteMany({
    where: { OR: [{ userId }, { expiresAt: { lt: new Date(now) } }] },
  });
  const cid = randomBytes(32).toString("base64url");
  await prisma.twoFactorChallenge.create({
    data: {
      id: sha256(cid),
      userId,
      ip,
      expiresAt: new Date(now + CHALLENGE_TTL_MS),
    },
  });
  const c = await challengeCookie();
  c.cid = cid;
  await c.save();
}

/** Etape en cours (non expiree), ou null. */
export async function getTwoFactorChallenge() {
  const c = await challengeCookie();
  if (!c.cid) return null;
  const row = await prisma.twoFactorChallenge.findUnique({
    where: { id: sha256(c.cid) },
    include: { user: { select: { email: true } } },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function recordChallengeFailure(id: string) {
  await prisma.twoFactorChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

export async function clearTwoFactorChallenge(id?: string) {
  if (id) await prisma.twoFactorChallenge.deleteMany({ where: { id } });
  (await challengeCookie()).destroy();
}

// --- Enrolement ----------------------------------------------------------

/** Genere un secret en attente et renvoie l'URI otpauth:// a scanner. */
export async function startEnrollment(userId: string, email: string) {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpPendingSecret: encryptTotpSecret(secret) },
  });
  return { secret, uri: totpAuthUri(secret, email) };
}

/**
 * Confirme l'enrolement avec un premier code : active la 2FA et renvoie des
 * codes de recuperation (affiches une seule fois). null si code invalide.
 */
export async function confirmEnrollment(
  userId: string,
  code: string
): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpPendingSecret: true },
  });
  if (!user?.totpPendingSecret) return null;
  const counter = matchTotp(decryptTotpSecret(user.totpPendingSecret), code);
  if (counter === null) return null;
  const { codes, stored } = newRecoveryCodes();
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpLastCounter: counter,
      totpRecoveryCodes: stored,
    },
  });
  return codes;
}

/** Nouveaux codes de recuperation (les anciens sont invalides). */
export async function regenerateRecoveryCodes(userId: string) {
  const { codes, stored } = newRecoveryCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { totpRecoveryCodes: stored },
  });
  return codes;
}

/** Donnees a effacer pour desactiver la 2FA d'un compte. */
export const TWO_FACTOR_DISABLED = {
  totpSecret: null,
  totpPendingSecret: null,
  totpLastCounter: null,
  totpRecoveryCodes: null,
} as const;
