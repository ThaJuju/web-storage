// Prisma 7 ne charge plus .env : a importer avant le client.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from "../src/lib/totp-crypto";


/**
 * Chiffre les secrets TOTP encore stockes en clair (comptes enroles avant le
 * chiffrement au repos). Idempotent. A lancer une fois apres deploiement :
 *   npm run encrypt-totp
 * (les secrets en clair sont aussi re-chiffres a la premiere connexion 2FA.)
 */
async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] },
    select: { id: true, email: true, totpSecret: true, totpPendingSecret: true },
  });
  let n = 0;
  for (const u of users) {
    const data: { totpSecret?: string; totpPendingSecret?: string } = {};
    if (u.totpSecret && !isEncryptedTotpSecret(u.totpSecret)) {
      data.totpSecret = encryptTotpSecret(u.totpSecret);
    }
    if (u.totpPendingSecret && !isEncryptedTotpSecret(u.totpPendingSecret)) {
      data.totpPendingSecret = encryptTotpSecret(u.totpPendingSecret);
    }
    if (Object.keys(data).length) {
      await prisma.user.update({ where: { id: u.id }, data });
      console.log(`Secret chiffre : ${u.email}`);
      n++;
    }
  }
  console.log(`${n} compte(s) mis a jour.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
