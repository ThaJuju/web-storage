import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Chiffrement au repos des secrets TOTP (AES-256-GCM). Une fuite de la base
 * (sauvegarde, copie de dev.db...) ne donne donc plus directement les seconds
 * facteurs. Cle derivee (HKDF-SHA256) de TOTP_ENCRYPTION_KEY, ou a defaut de
 * SESSION_SECRET ; definir TOTP_ENCRYPTION_KEY permet de faire tourner le
 * secret de session sans invalider les 2FA existantes.
 *
 * Format stocke : "v1:" + base64url(iv[12] | tag[16] | chiffre).
 */
const PREFIX = "v1:";

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const ikm = process.env.TOTP_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!ikm || ikm.length < 32) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY (ou SESSION_SECRET) manquant ou trop court (>= 32 caracteres)."
    );
  }
  cachedKey = Buffer.from(
    hkdfSync("sha256", ikm, "", "webstorage-totp-secret-v1", 32)
  );
  return cachedKey;
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * Dechiffre un secret stocke. Les secrets historiques en clair (sans
 * prefixe) sont renvoyes tels quels : `isEncryptedTotpSecret` permet de les
 * re-chiffrer (cf. scripts/encrypt-totp-secrets.ts et la connexion).
 */
export function decryptTotpSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function isEncryptedTotpSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
