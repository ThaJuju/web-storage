import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { INACTIVITY_TIMEOUT_MS } from "./constants";

/**
 * Sessions cote serveur. Le cookie iron-session (chiffre + signe) ne contient
 * qu'un identifiant aleatoire ; l'etat (utilisateur, derniere activite,
 * expiration) vit en base dans la table Session. On ne fait donc JAMAIS
 * confiance au cookie pour le role ou l'existence du compte : tout est relu
 * en base a chaque requete, et supprimer une ligne Session revoque
 * immediatement la session correspondante.
 */
export interface SessionData {
  sid?: string;
}

export { INACTIVITY_TIMEOUT_MS };
// Duree de vie absolue d'une session, meme utilisee en continu.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// lastSeenAt n'est reecrit qu'au plus une fois par minute (limite les writes).
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    "SESSION_SECRET manquant ou trop court (>= 32 caracteres requis). Voir .env.example."
  );
}

// Cookie "secure" (HTTPS uniquement) : active seulement si l'app est servie
// derriere du TLS. En acces HTTP (LAN/local), le mettre a true empecherait le
// navigateur d'envoyer le cookie -> login casse. Piloté par APP_HTTPS.
export const isHttps = process.env.APP_HTTPS === "true";

export const sessionOptions: SessionOptions = {
  password: secret,
  cookieName: "webstorage_session",
  cookieOptions: {
    httpOnly: true,
    secure: isHttps,
    sameSite: "strict",
    path: "/",
    // L'inactivite est geree cote serveur (lastSeenAt) ; le cookie vit au
    // plus aussi longtemps que la session absolue.
    maxAge: SESSION_MAX_AGE_MS / 1000,
  },
};

// Cookie present mais session invalide : route qui efface le cookie puis
// renvoie sur /login (evite une boucle de redirection).
export const SESSION_EXPIRED_PATH = "/api/auth/expired";

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

function hashSid(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

/**
 * Ouvre une nouvelle session pour l'utilisateur et pose le cookie. Purge au
 * passage les sessions expirees (toutes utilisateurs confondus).
 */
export async function createSession(userId: string): Promise<void> {
  const now = Date.now();
  await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(now) } },
        { lastSeenAt: { lt: new Date(now - INACTIVITY_TIMEOUT_MS) } },
      ],
    },
  });

  const sid = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      id: hashSid(sid),
      userId,
      expiresAt: new Date(now + SESSION_MAX_AGE_MS),
    },
  });

  const session = await getSession();
  session.sid = sid;
  await session.save();
}

/** Supprime la session courante (base + cookie). */
export async function destroyCurrentSession(): Promise<void> {
  const session = await getSession();
  if (session.sid) {
    await prisma.session.deleteMany({ where: { id: hashSid(session.sid) } });
  }
  session.destroy();
}

/**
 * Revoque toutes les sessions d'un utilisateur (changement de mot de passe,
 * reinitialisation 2FA, "deconnecter partout"...).
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/** Revoque toutes les sessions de l'utilisateur SAUF la session courante. */
export async function revokeOtherSessions(userId: string): Promise<void> {
  const session = await getSession();
  const current = session.sid ? hashSid(session.sid) : "";
  await prisma.session.deleteMany({ where: { userId, id: { not: current } } });
}

/**
 * Renvoie l'utilisateur authentifie, ou null si :
 * - pas de cookie / cookie invalide,
 * - session inconnue en base (revoquee, compte supprime...),
 * - inactivite depassee ou duree de vie absolue atteinte.
 * Le role admin est relu en base a chaque appel. `touch: false` verifie la
 * session sans prolonger son TTL glissant.
 */
export async function getAuthenticatedUser({
  touch = true,
}: { touch?: boolean } = {}): Promise<{
  userId: string;
  isAdmin: boolean;
} | null> {
  const session = await getSession();
  if (!session.sid) return null;

  const id = hashSid(session.sid);
  const row = await prisma.session.findUnique({
    where: { id },
    select: {
      lastSeenAt: true,
      expiresAt: true,
      user: { select: { id: true, isAdmin: true } },
    },
  });
  if (!row) return null;

  const now = Date.now();
  if (
    row.expiresAt.getTime() <= now ||
    now - row.lastSeenAt.getTime() > INACTIVITY_TIMEOUT_MS
  ) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }

  // TTL glissant cote serveur : fonctionne aussi depuis un Server Component
  // (aucune ecriture de cookie necessaire).
  if (touch && now - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await prisma.session.updateMany({
      where: { id },
      data: { lastSeenAt: new Date(now) },
    });
  }

  return { userId: row.user.id, isAdmin: row.user.isAdmin };
}
