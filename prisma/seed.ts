import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Cree le compte initial (aucune inscription publique). Le mot de passe est
 * genere aleatoirement et affiche UNE SEULE FOIS dans la console. A changer
 * ensuite via `npm run set-password`.
 */
async function main() {
  const email = (process.env.SEED_EMAIL ?? "admin@example.com")
    .trim()
    .toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`\nℹ️  Le compte ${email} existe deja. Aucune action.`);
    console.log("   Pour changer son mot de passe : npm run set-password\n");
    return;
  }

  // Mot de passe initial fort, aleatoire, jamais stocke en clair.
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: { email, passwordHash, isAdmin: true },
  });

  console.log("\n✅ Compte administrateur cree :");
  console.log(`   Email        : ${email}`);
  console.log(`   Mot de passe : ${password}`);
  console.log(
    "\n⚠️  Notez ce mot de passe : il ne sera plus affiche."
  );
  console.log("   Changez-le apres la premiere connexion : npm run set-password\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
