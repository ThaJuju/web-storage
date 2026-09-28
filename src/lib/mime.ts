/**
 * Politique de types MIME. Le Content-Type d'un fichier est fourni par le
 * client a l'upload : il ne doit JAMAIS decider seul de la facon dont le
 * navigateur interprete le contenu servi depuis l'origine de l'application
 * (sinon un .html / .svg piege s'execute avec le cookie de session).
 */

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

/**
 * Normalise un Content-Type fourni a l'upload : minuscules, parametres
 * retires (";charset=..."), forme type/sous-type stricte, 127 car. max.
 * Renvoie null si invalide.
 */
export function normalizeMimeType(input: string | null): string | null {
  if (!input) return null;
  const base = input.split(";")[0].trim().toLowerCase();
  if (base.length > 127 || !MIME_RE.test(base)) return null;
  return base;
}

// Types que le navigateur peut afficher inline sans executer de script.
const INLINE_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
]);

// Types textuels (dont balisage) : affiches comme texte brut, jamais interpretes.
const TEXT_LIKE = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/x-sh",
  "application/sql",
]);

export interface ServingPolicy {
  contentType: string;
  // true = le fichier ne peut etre servi qu'en telechargement.
  forceAttachment: boolean;
}

/**
 * Decide comment servir un fichier stocke :
 * - video/audio et images matricielles / PDF : type d'origine, inline permis ;
 * - SVG : image/svg+xml (necessaire pour <img>, ou il ne peut rien executer)
 *   mais toujours en attachment si on l'ouvre directement ;
 * - text/*, JSON, XML... : text/plain; charset=utf-8 ;
 * - tout le reste (dont text/html) : application/octet-stream en attachment.
 */
export function servingPolicy(mimeType: string | null): ServingPolicy {
  const mime = normalizeMimeType(mimeType);
  if (!mime) {
    return { contentType: "application/octet-stream", forceAttachment: true };
  }
  if (
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    INLINE_SAFE.has(mime)
  ) {
    return { contentType: mime, forceAttachment: false };
  }
  if (mime === "image/svg+xml") {
    return { contentType: mime, forceAttachment: true };
  }
  if (
    mime.startsWith("text/") ||
    TEXT_LIKE.has(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return { contentType: "text/plain; charset=utf-8", forceAttachment: false };
  }
  return { contentType: "application/octet-stream", forceAttachment: true };
}

/**
 * CSP appliquee aux contenus utilisateur servis depuis l'origine de l'app :
 * aucun script, aucun sous-chargement, document isole (sandbox).
 */
export const USER_CONTENT_CSP =
  "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
