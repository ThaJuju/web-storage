import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getLoginLockout } from "@/lib/rate-limit";

// getLoginLockout lit le journal des connexions : on l'alimente directement.
const prisma = new PrismaClient();
const EMAIL = "cible@test.fr";

async function fail(email: string, ip: string, n = 1) {
  await prisma.loginLog.createMany({
    data: Array.from({ length: n }, () => ({ email, ip, success: false })),
  });
}

beforeEach(() => prisma.loginLog.deleteMany({ where: { email: { endsWith: "@lock.test" } } }).then(() =>
  prisma.loginLog.deleteMany({ where: { email: EMAIL } })
));
afterAll(() => prisma.$disconnect());

describe("getLoginLockout", () => {
  it("bloque le couple (email, ip) apres 5 echecs", async () => {
    await fail(EMAIL, "10.0.0.1", 4);
    expect((await getLoginLockout(EMAIL, "10.0.0.1")).locked).toBe(false);
    await fail(EMAIL, "10.0.0.1");
    const lock = await getLoginLockout(EMAIL, "10.0.0.1");
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSec).toBeGreaterThan(0);
    expect(lock.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("ne bloque PAS le proprietaire depuis une autre IP (pas de DoS par email)", async () => {
    await fail(EMAIL, "10.0.0.1", 12);
    expect((await getLoginLockout(EMAIL, "10.0.0.2")).locked).toBe(false);
  });

  it("ralentit un compte vise depuis de nombreuses IP", async () => {
    for (let i = 0; i < 10; i++) await fail(EMAIL, `10.1.0.${i}`);
    const r = await getLoginLockout(EMAIL, "10.2.0.1");
    expect(r.locked).toBe(false);
    expect(r.slowdownMs).toBeGreaterThan(0);
  });

  it("bloque une IP qui arrose de nombreux comptes (spraying)", async () => {
    for (let i = 0; i < 20; i++) await fail(`u${i}@lock.test`, "10.3.0.1");
    expect((await getLoginLockout("nouveau@lock.test", "10.3.0.1")).locked).toBe(true);
  });

  it("delai progressif plafonne a 30 min", async () => {
    await fail(EMAIL, "10.0.0.9", 20);
    const { retryAfterSec } = await getLoginLockout(EMAIL, "10.0.0.9");
    expect(retryAfterSec).toBeGreaterThan(29 * 60);
    expect(retryAfterSec).toBeLessThanOrEqual(30 * 60);
  });

  it("un succes remet le compteur du couple a zero", async () => {
    await fail(EMAIL, "10.0.0.5", 5);
    await prisma.loginLog.create({ data: { email: EMAIL, ip: "10.0.0.5", success: true } });
    expect((await getLoginLockout(EMAIL, "10.0.0.5")).locked).toBe(false);
  });
});
