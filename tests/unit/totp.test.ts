import { describe, expect, it } from "vitest";
import {
  generateTotp,
  generateTotpSecret,
  matchTotp,
  totpAuthUri,
  verifyTotp,
} from "@/lib/totp";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from "@/lib/totp-crypto";

// RFC 6238, annexe B (SHA-1) : secret ASCII "12345678901234567890", codes a 8
// chiffres. Notre implementation produit 6 chiffres = les 6 derniers
// (code % 10^6 = (code % 10^8) % 10^6).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 du secret ASCII
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("vecteur T=%i", (t, code8) => {
    const now = t * 1000;
    const expected = code8.slice(-6);
    expect(generateTotp(RFC_SECRET, now)).toBe(expected);
    expect(matchTotp(RFC_SECRET, expected, { now })).toBe(Math.floor(t / 30));
  });

  it("tolere +/- 1 pas et renvoie le compteur reconnu", () => {
    const now = 1_700_000_000_000;
    const counter = Math.floor(now / 30_000);
    const prev = generateTotp(RFC_SECRET, now - 30_000);
    const next = generateTotp(RFC_SECRET, now + 30_000);
    expect(matchTotp(RFC_SECRET, prev, { now })).toBe(counter - 1);
    expect(matchTotp(RFC_SECRET, next, { now })).toBe(counter + 1);
    expect(matchTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 90_000), { now })).toBeNull();
  });

  it("refuse les formats invalides", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 456"]) {
      expect(verifyTotp(RFC_SECRET, bad)).toBe(false);
    }
  });

  it("genere des secrets base32 de 160 bits", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it("construit une URI otpauth://", () => {
    const uri = totpAuthUri("ABC", "a@b.fr");
    expect(uri).toMatch(/^otpauth:\/\/totp\/WebStorage:a%40b\.fr\?/);
    expect(uri).toContain("secret=ABC");
  });
});

describe("chiffrement des secrets TOTP", () => {
  it("aller-retour AES-GCM, IV aleatoire", () => {
    const a = encryptTotpSecret(RFC_SECRET);
    const b = encryptTotpSecret(RFC_SECRET);
    expect(isEncryptedTotpSecret(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain(RFC_SECRET);
    expect(decryptTotpSecret(a)).toBe(RFC_SECRET);
  });

  it("renvoie tel quel un secret historique en clair", () => {
    expect(isEncryptedTotpSecret(RFC_SECRET)).toBe(false);
    expect(decryptTotpSecret(RFC_SECRET)).toBe(RFC_SECRET);
  });

  it("detecte une alteration (tag GCM)", () => {
    const enc = encryptTotpSecret(RFC_SECRET);
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
    expect(() => decryptTotpSecret(tampered)).toThrow();
  });
});
