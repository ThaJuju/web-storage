import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "./session";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function error(message: string, status = 400, extra?: ResponseInit) {
  return NextResponse.json({ error: message }, { ...extra, status });
}

/**
 * Verifie l'origine d'une requete mutante (POST/PATCH/DELETE) : le header
 * Origin doit correspondre a l'hote de la requete. Deuxieme couche anti-CSRF
 * en plus du cookie sameSite=strict.
 */
export function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Certains clients legitimes (meme-origine, navigation) peuvent omettre
    // Origin sur GET ; pour les mutations on exige sa presence.
    return false;
  }
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get("host");
    return !!host && originHost === host;
  } catch {
    return false;
  }
}

/**
 * Garde standard pour une route d'API : exige une session valide et, pour les
 * methodes mutantes, une origine correcte. Renvoie l'utilisateur ou une
 * NextResponse d'erreur a retourner directement.
 */
export async function requireUser(
  req: NextRequest,
  { mutating = false }: { mutating?: boolean } = {}
): Promise<{ userId: string; isAdmin: boolean } | NextResponse> {
  if (mutating && !checkOrigin(req)) {
    return error("Origine invalide", 403);
  }
  const user = await getAuthenticatedUser();
  if (!user) return error("Non authentifie", 401);
  return user;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Garde pour les routes d'administration : session valide + role admin +
 * (pour les mutations) origine correcte. Renvoie l'utilisateur ou une erreur.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: { mutating?: boolean } = {}
): Promise<{ userId: string; isAdmin: boolean } | NextResponse> {
  const user = await requireUser(req, opts);
  if (isResponse(user)) return user;
  if (!user.isAdmin) return error("Acces refuse", 403);
  return user;
}
