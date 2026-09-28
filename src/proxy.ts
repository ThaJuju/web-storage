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
    pathname === "/api/auth/expired" ||
    pathname === "/api/auth/2fa" ||
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
  // NB : pas de redirection /login -> / sur la seule PRESENCE du cookie : un
  // cookie invalide provoquait une boucle infinie (/login -> / -> /login).
  // C'est app/login/layout.tsx qui redirige, apres validation en base.

  const isDev = process.env.NODE_ENV !== "production";
  // upgrade-insecure-requests forcerait le navigateur a passer en HTTPS : a
  // n'activer que si l'app est reellement servie en TLS (sinon erreur SSL en
  // acces HTTP). Piloté par APP_HTTPS.
  const isHttps = process.env.APP_HTTPS === "true";

  // Routes d'API : du JSON ou des fichiers, jamais de HTML de l'application.
  // Les routes qui servent du contenu utilisateur (content, zip) posent leur
  // propre CSP "sandbox" ; on ne l'ecrase pas.
  if (pathname.startsWith("/api/")) {
    const res = NextResponse.next();
    setCommonHeaders(res);
    return res;
  }

  // --- CSP a nonce ---
  // Nonce aleatoire par requete : Next.js l'extrait de l'en-tete CSP de la
  // requete et l'applique a ses propres scripts. Les pages doivent donc etre
  // rendues dynamiquement (cf. connection() dans app/layout.tsx). Plus de
  // 'unsafe-inline' pour les scripts : un script injecte sans le nonce est
  // bloque. Les styles gardent 'unsafe-inline' (attributs style= de React).
  const nonce = btoa(crypto.randomUUID());
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${
    isDev ? " 'unsafe-eval'" : ""
  }`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
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

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  setCommonHeaders(res);
  return res;
}

function setCommonHeaders(res: NextResponse) {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
}

export const config = {
  // On applique le proxy partout sauf :
  //  - aux assets statiques deja filtres ;
  //  - a la route d'upload : des qu'un proxy intercepte une requete, Next
  //    bufferise son corps jusqu'a proxyClientMaxBodySize (10 Mo) et TRONQUE
  //    le reste -> fichiers corrompus. La route fait sa propre auth
  //    (requireUser) et ne sert que du JSON, le proxy n'y apporte rien.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/nodes/[^/]+/upload$|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
