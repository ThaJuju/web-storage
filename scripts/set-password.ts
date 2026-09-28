import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const prisma = new PrismaClient();

/**
 * Change le mot de passe d'un compte existant.
 * Usage : npm run set-password -- <email>
 * Le mot de passe est saisi de facon masquee (jamais dans l'historique shell,
 * jamais dans les logs).
 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("Usage : npm run set-password -- <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Aucun compte pour ${email}.`);
    process.exit(1);
  }

  const pw1 = await askHidden(`Nouveau mot de passe pour ${email} : `);
  if (pw1.length < 10) {
    console.error("Le mot de passe doit faire au moins 10 caracteres.");
    process.exit(1);
  }
  const pw2 = await askHidden("Confirmez le mot de passe : ");
  if (pw1 !== pw2) {
    console.error("Les mots de passe ne correspondent pas.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(pw1, 12);
  await prisma.user.update({ where: { email }, data: { passwordHash } });
  console.log(`\n✅ Mot de passe mis a jour pour ${email}.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
