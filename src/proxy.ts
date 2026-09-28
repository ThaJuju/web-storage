import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy global (ex-"middleware", renomme selon la convention Next.js 16) :
 *  1. Redirection deny-by-default : sans cookie de session, seules /login et
 *     ses routes d'API sont accessibles (verification rapide de presence ;
 *     la VALIDATION reelle de la session — dechiffrement, inactivite,
 *     ownership — est faite cote serveur dans chaque page/route via
 *     getAuthenticatedUser / requireUser, qui constitue la vraie frontiere
 *     de securite).
 *  2. Headers de securite (CSP a nonce, X-Frame-Options, etc.).
 */

const SESSION_COOKIE = "webstorage_session";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  // Redirection UX (la securite reelle est cote serveur).
  if (!hasSession && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Deja connecte -> pas de raison de revoir /login.
  if (hasSession && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // --- CSP ---
  // Note : on n'utilise PAS de nonce + strict-dynamic. Next.js ne peut injecter
  // un nonce que dans les pages rendues dynamiquement ; les pages statiques
  // (ex: /login) recevraient alors des <script> sans nonce -> tous bloques ->
  // React ne s'hydrate pas. On retient donc 'unsafe-inline' pour les scripts,
  // compromis acceptable ici : tout le contenu est echappe par React (surface
  // XSS minime), les gros scripts sont des chunks 'self'.
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'unsafe-inline'`;

  // upgrade-insecure-requests forcerait le navigateur a passer en HTTPS : a
  // n'activer que si l'app est reellement servie en TLS (sinon erreur SSL en
  // acces HTTP). Piloté par APP_HTTPS.
  const isHttps = process.env.APP_HTTPS === "true";

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // Next injecte des styles inline ; 'unsafe-inline' est acceptable pour les styles.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `media-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  return res;
}

export const config = {
  // On applique le middleware partout sauf aux assets statiques deja filtres.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
