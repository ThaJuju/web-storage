// Validation / sanitization strictes cote serveur.

export const MAX_NAME_LENGTH = 255;

/**
 * Nettoie un nom de fichier ou dossier fourni par le client.
 * - retire tout composant de chemin (path traversal, separateurs),
 * - retire les caracteres de controle et reserves,
 * - refuse les noms vides, "." et "..".
 * Renvoie null si le nom est irrecuperable.
 *
 * NB : ce nom n'est utilise que pour l'AFFICHAGE et stocke en base. Il ne sert
 * jamais a construire un chemin disque (voir storage.ts), c'est une defense
 * supplementaire, pas la seule.
 */
export function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;

  // Ne garder que le dernier segment : neutralise "../", "a/b", "C:\..." etc.
  let name = input.replace(/\\/g, "/").split("/").pop() ?? "";
  name = name.trim();

  // Caracteres de controle (0x00-0x1F, 0x7F).
  name = name.replace(/[\x00-\x1f\x7f]/g, "");
  // Caracteres reserves usuels des systemes de fichiers.
  name = name.replace(/[<>:"/\\|?*]/g, "");

  // Points de fin / espaces (problematiques sur certains FS).
  name = name.replace(/[. ]+$/g, "").trim();

  if (!name || name === "." || name === "..") return null;
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH);

  return name;
}

/**
 * Valide un chemin relatif d'upload de dossier (webkitRelativePath) segment
 * par segment. Renvoie la liste des dossiers parents nettoyes + le nom de
 * fichier, ou null si un segment est invalide.
 */
export function sanitizeRelativePath(
  input: unknown
): { folders: string[]; fileName: string } | null {
  if (typeof input !== "string" || !input) return null;
  const rawSegments = input.replace(/\\/g, "/").split("/").filter(Boolean);
  if (rawSegments.length === 0) return null;

  const clean: string[] = [];
  for (const seg of rawSegments) {
    const s = sanitizeName(seg);
    if (!s) return null;
    clean.push(s);
  }
  const fileName = clean.pop()!;
  return { folders: clean, fileName };
}

export function isValidEmail(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)
  );
}

/**
 * Convertit un quota exprime en Go (nombre) vers des octets (base 1000), ou
 * null si absent/invalide. Plafonne a 100 000 Go par securite.
 */
export function parseQuota(input: unknown): bigint | null {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return BigInt(Math.round(n * 1_000_000_000));
}
