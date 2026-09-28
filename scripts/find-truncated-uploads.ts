import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Liste les fichiers probablement tronques par l'ancien bug du proxy (issue
 * #1) : avant le correctif, tout upload > 10 Mo etait coupe juste sous
 * 10 Mio (proxyClientMaxBodySize), sans erreur. Ces fichiers ont donc une
 * taille tres proche de 10 485 760 octets, par valeur inferieure.
 * Usage : npm run find-truncated
 */
const LIMIT = 10 * 1024 * 1024;
const MARGIN = 256 * 1024;

async function main() {
  const suspects = await prisma.node.findMany({
    where: {
      type: "FILE",
      size: { gte: BigInt(LIMIT - MARGIN), lte: BigInt(LIMIT) },
    },
    select: {
      id: true,
      name: true,
      size: true,
      createdAt: true,
      owner: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (suspects.length === 0) {
    console.log("Aucun fichier suspect.");
    return;
  }
  console.log(`${suspects.length} fichier(s) probablement tronque(s) :\n`);
  for (const s of suspects) {
    console.log(
      `${s.owner.email}\t${s.name}\t${s.size} o\t${s.createdAt.toISOString()}\t${s.id}`
    );
  }
  console.log("\nA re-uploader depuis l'original puis supprimer.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
