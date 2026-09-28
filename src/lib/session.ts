import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  isAdmin?: boolean;
  // timestamp (ms) de la derniere activite — sert au timeout d'inactivite
  lastSeen?: number;
  // etape de connexion : true quand le mot de passe est valide mais la 2FA pas encore fournie
  pendingTwoFactor?: boolean;
}

// Deconnexion automatique apres 30 min d'inactivite (TTL glissant).
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

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
    // La duree de vie effective est geree cote serveur via lastSeen (TTL glissant).
    maxAge: INACTIVITY_TIMEOUT_MS / 1000,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Renvoie l'utilisateur authentifie, ou null si :
 * - pas de session,
 * - 2FA en attente,
 * - inactivite depassee (la session est alors detruite).
 * Met a jour lastSeen (TTL glissant) a chaque acces valide.
 */
export async function getAuthenticatedUser(): Promise<{
  userId: string;
  isAdmin: boolean;
} | null> {
  const session = await getSession();
  if (!session.userId || session.pendingTwoFactor) return null;

  const now = Date.now();
  if (session.lastSeen && now - session.lastSeen > INACTIVITY_TIMEOUT_MS) {
    try {
      session.destroy();
    } catch {
      // Server Component : ecriture cookie interdite. La session sera de toute
      // facon rejetee ici (retour null) et nettoyee au prochain Route Handler.
    }
    return null;
  }

  // Rafraichit le TTL glissant. Interdit d'ecrire un cookie pendant le rendu
  // d'un Server Component -> best-effort : les appels API (Route Handlers) du
  // client rafraichissent lastSeen en continu, donc le TTL reste correct.
  session.lastSeen = now;
  try {
    await session.save();
  } catch {
    // Contexte Server Component : on ignore, la lecture reste valide.
  }
  return { userId: session.userId, isAdmin: !!session.isAdmin };
}
