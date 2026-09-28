import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getAuthenticatedUser,
  isHttps,
} from "@/lib/session";

/**
 * GET /api/auth/expired
 * Destination des pages protegees quand le cookie de session est present
 * mais invalide (secret change, session expiree ou revoquee, cookie
 * corrompu...) : supprime le cookie puis renvoie sur /login. Sans cela, le
 * cookie restait en place et le navigateur tournait en boucle.
 * Si la session est en fait valide, renvoie simplement sur l'explorateur
 * (pas de deconnexion forcee par un lien tiers).
 */
export async function GET(req: NextRequest) {
  if (await getAuthenticatedUser()) {
    return NextResponse.redirect(new URL("/folder/root", req.url));
  }
  // La ligne Session eventuelle est deja supprimee par getAuthenticatedUser
  // (expiree) ou n'existe plus (revoquee) : il ne reste que le cookie.
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps,
  });
  return res;
}
