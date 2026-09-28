import path from "node:path";

/**
 * URL SQLite absolue a partir de DATABASE_URL.
 *
 * Avant Prisma 7, un chemin relatif ("file:./dev.db") etait resolu par
 * rapport au dossier du schema (prisma/) : la base de production vit donc
 * dans prisma/dev.db. Les adaptateurs de Prisma 7 le resoudraient par
 * rapport au dossier courant, ce qui ouvrirait une base VIDE a la racine.
 * On conserve donc explicitement l'ancien comportement.
 */
export function sqliteUrl(
  raw = process.env.DATABASE_URL,
  projectRoot = process.cwd()
): string {
  if (!raw) {
    throw new Error("DATABASE_URL manquant (ex. file:./dev.db). Voir .env.example.");
  }
  if (!raw.startsWith("file:")) return raw;
  const file = raw.slice("file:".length);
  if (path.isAbsolute(file)) return raw;
  return `file:${path.resolve(projectRoot, "prisma", file)}`;
}
