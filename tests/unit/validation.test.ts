import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  parseQuota,
  passwordError,
  sanitizeName,
  sanitizeRelativePath,
} from "@/lib/validation";

describe("sanitizeName", () => {
  it("garde un nom ordinaire", () => {
    expect(sanitizeName("rapport 2026.pdf")).toBe("rapport 2026.pdf");
    expect(sanitizeName("Été ⭐.txt")).toBe("Été ⭐.txt");
  });

  it("neutralise le path traversal (dernier segment seulement)", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("a/b/c.txt")).toBe("c.txt");
    expect(sanitizeName("C:\\Windows\\system32\\x.dll")).toBe("x.dll");
  });

  it("retire caracteres de controle, reserves, points et espaces finaux", () => {
    expect(sanitizeName("a\u0000b\u001fc")).toBe("abc");
    expect(sanitizeName('a<>:"|?*b')).toBe("ab");
    expect(sanitizeName("  nom. . ")).toBe("nom");
  });

  it("refuse les noms vides ou speciaux", () => {
    for (const bad of ["", "   ", ".", "..", "../", "...", 42, null, undefined]) {
      expect(sanitizeName(bad)).toBeNull();
    }
  });

  it(`tronque a ${MAX_NAME_LENGTH} caracteres`, () => {
    expect(sanitizeName("x".repeat(400))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe("sanitizeRelativePath", () => {
  it("separe dossiers et nom de fichier", () => {
    expect(sanitizeRelativePath("Photos/2026/ete.jpg")).toEqual({
      folders: ["Photos", "2026"],
      fileName: "ete.jpg",
    });
    expect(sanitizeRelativePath("a\\b\\c.txt")).toEqual({
      folders: ["a", "b"],
      fileName: "c.txt",
    });
  });

  it("ignore les separateurs superflus", () => {
    expect(sanitizeRelativePath("/a//b.txt")).toEqual({
      folders: ["a"],
      fileName: "b.txt",
    });
  });

  it("refuse un segment invalide (traversal)", () => {
    expect(sanitizeRelativePath("a/../b.txt")).toBeNull();
    expect(sanitizeRelativePath("./a.txt")).toBeNull();
    expect(sanitizeRelativePath("")).toBeNull();
    expect(sanitizeRelativePath(undefined)).toBeNull();
  });
});

describe("parseQuota", () => {
  it("convertit des Go (base 1000) en octets", () => {
    expect(parseQuota(50)).toBe(50_000_000_000n);
    expect(parseQuota("1.5")).toBe(1_500_000_000n);
  });

  it("refuse les valeurs invalides ou hors bornes", () => {
    for (const bad of [0, -1, "abc", NaN, Infinity, 100_001, null, undefined]) {
      expect(parseQuota(bad)).toBeNull();
    }
    expect(parseQuota(100_000)).toBe(100_000_000_000_000n);
  });
});

describe("passwordError", () => {
  it("accepte 10 a 72 octets", () => {
    expect(passwordError("a".repeat(10))).toBeNull();
    expect(passwordError("a".repeat(72))).toBeNull();
  });

  it("refuse trop court, trop long (octets, pas caracteres) ou non-chaine", () => {
    expect(passwordError("a".repeat(9))).not.toBeNull();
    expect(passwordError("a".repeat(73))).not.toBeNull();
    // 37 caracteres accentues = 74 octets UTF-8 (bcrypt tronquerait).
    expect(passwordError("é".repeat(37))).not.toBeNull();
    expect(passwordError(undefined)).not.toBeNull();
  });
});
