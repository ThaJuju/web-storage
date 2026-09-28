import { PrismaClient } from "@prisma/client";
import { readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

/**
 * Reconciliation base <-> disque.
 *  1. usedBytes de chaque utilisateur = SUM(size) de ses fichiers.
 *  2. Fichiers disque sans Node (crash entre ecriture disque et transaction,
 *     effacement post-commit rate...) et dossiers d'utilisateurs supprimes.
 *  3. Nodes FILE dont le fichier disque est absent (signales seulement).
 *
 * Usage :
 *   npm run reconcile            # rapport seul (aucune modification)
 *   npm run reconcile -- --fix   # corrige usedBytes et supprime les orphelins disque
 *
 * A lancer de preference application arretee (ou peu sollicitee) : un upload
 * en cours d'ecriture n'a pas encore de Node et serait vu comme orphelin.
 * Par securite, les fichiers modifies il y a moins d'une heure sont ignores.
 */
const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");
const fix = process.argv.includes("--fix");
const RECENT_MS = 60 * 60 * 1000;

async function listDir(dir: string) {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

async function main() {
  console.log(`Stockage : ${STORAGE_ROOT}${fix ? "  (mode --fix)" : "  (rapport seul)"}\n`);

  // --- 1. Quota ------------------------------------------------------------
  const users = await prisma.user.findMany({
    select: { id: true, email: true, usedBytes: true },
  });
  const sums = await prisma.node.groupBy({
    by: ["ownerId"],
    where: { type: "FILE" },
    _sum: { size: true },
  });
  const sumByOwner = new Map(sums.map((s) => [s.ownerId, s._sum.size ?? 0n]));
  let quotaFixes = 0;
  for (const u of users) {
    const real = sumByOwner.get(u.id) ?? 0n;
    if (real !== u.usedBytes) {
      quotaFixes++;
      console.log(`[quota] ${u.email} : usedBytes=${u.usedBytes} reel=${real}`);
      if (fix) {
        await prisma.user.update({ where: { id: u.id }, data: { usedBytes: real } });
      }
    }
  }

  // --- 2. Orphelins disque -------------------------------------------------
  const userIds = new Set(users.map((u) => u.id));
  const keys = new Set(
    (
      await prisma.node.findMany({
        where: { type: "FILE", storageKey: { not: null } },
        select: { storageKey: true },
      })
    ).map((n) => n.storageKey as string)
  );
  const now = Date.now();
  let orphanFiles = 0;
  let orphanDirs = 0;
  const seenOnDisk = new Set<string>();

  for (const ownerDir of await listDir(STORAGE_ROOT)) {
    if (!ownerDir.isDirectory()) continue;
    const ownerPath = path.join(STORAGE_ROOT, ownerDir.name);
    if (!userIds.has(ownerDir.name)) {
      orphanDirs++;
      console.log(`[disque] dossier d'un utilisateur inexistant : ${ownerPath}`);
      if (fix) await rm(ownerPath, { recursive: true, force: true });
      continue;
    }
    for (const shard of await listDir(ownerPath)) {
      if (!shard.isDirectory()) continue;
      const shardPath = path.join(ownerPath, shard.name);
      for (const file of await listDir(shardPath)) {
        seenOnDisk.add(file.name);
        if (keys.has(file.name)) continue;
        const filePath = path.join(shardPath, file.name);
        const { mtimeMs, size } = await stat(filePath);
        if (now - mtimeMs < RECENT_MS) {
          console.log(`[disque] ignore (recent, upload en cours ?) : ${filePath}`);
          continue;
        }
        orphanFiles++;
        console.log(`[disque] fichier sans Node (${size} o) : ${filePath}`);
        if (fix) await unlink(filePath);
      }
    }
  }

  // --- 3. Nodes sans fichier -----------------------------------------------
  let missing = 0;
  for (const key of keys) {
    if (!seenOnDisk.has(key)) {
      missing++;
      const n = await prisma.node.findFirst({
        where: { storageKey: key },
        select: { id: true, name: true, owner: { select: { email: true } } },
      });
      console.log(`[base] fichier absent du disque : ${n?.owner.email} « ${n?.name} » (${n?.id})`);
    }
  }

  console.log(
    `\nBilan : ${quotaFixes} quota(s) faux, ${orphanFiles} fichier(s) et ${orphanDirs} dossier(s) orphelin(s) sur disque, ${missing} fichier(s) manquant(s).`
  );
  if (!fix && quotaFixes + orphanFiles + orphanDirs > 0) {
    console.log("Relancer avec --fix pour corriger (les fichiers manquants sont seulement signales).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
