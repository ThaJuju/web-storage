import { prisma } from "./db";

/**
 * Token bucket en memoire pour un rate limiting simple par cle (ip:route).
 * Suffisant en mono-instance ; a remplacer par Redis en multi-instance.
 */
type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  { capacity, refillPerSec }: { capacity: number; refillPerSec: number }
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.updatedAt = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
    return { allowed: false, retryAfterSec };
  }

  b.tokens -= 1;
  buckets.set(key, b);
  return { allowed: true, retryAfterSec: 0 };
}

// --- Anti brute-force sur le login (persiste, delai progressif) -------------

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000; // fenetre d'observation des echecs

/**
 * Compte les echecs recents pour un couple (email, ip) et renvoie un eventuel
 * temps de blocage. Delai progressif : 5 echecs -> 1 min, puis x2 par echec
 * supplementaire (1, 2, 4, 8 min...), plafonne a 30 min.
 */
export async function getLoginLockout(
  email: string,
  ip: string
): Promise<{ locked: boolean; retryAfterSec: number }> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);

  const recent = await prisma.loginLog.findMany({
    where: {
      success: false,
      createdAt: { gte: since },
      OR: [{ email }, { ip }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // On ne compte que les echecs depuis le dernier succes eventuel dans la fenetre.
  const lastSuccess = await prisma.loginLog.findFirst({
    where: { success: true, email, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const failures = lastSuccess
    ? recent.filter((r) => r.createdAt > lastSuccess.createdAt)
    : recent;

  if (failures.length < MAX_FAILURES) {
    return { locked: false, retryAfterSec: 0 };
  }

  const over = failures.length - MAX_FAILURES;
  const penaltyMin = Math.min(30, Math.pow(2, over)); // 1,2,4,8,16,30
  const lastFailure = failures[0].createdAt.getTime();
  const unlockAt = lastFailure + penaltyMin * 60 * 1000;
  const retryAfterSec = Math.ceil((unlockAt - Date.now()) / 1000);

  return retryAfterSec > 0
    ? { locked: true, retryAfterSec }
    : { locked: false, retryAfterSec: 0 };
}
