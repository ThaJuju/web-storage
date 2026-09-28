import { prisma } from "./db";

/**
 * Token bucket en memoire pour un rate limiting simple par cle (ip:route).
 * Suffisant en mono-instance ; a remplacer par Redis en multi-instance.
 */
type Bucket = {
  tokens: number;
  updatedAt: number;
  capacity: number;
  refillPerSec: number;
};
const buckets = new Map<string, Bucket>();

// Borne memoire : au-dela, les buckets les moins recemment utilises sont
// evinces (Map = ordre d'insertion, on reinsere a chaque acces -> LRU).
const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweep = 0;

/** Retire les buckets redevenus pleins : ils equivalent a une absence d'entree. */
function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const elapsed = (now - b.updatedAt) / 1000;
    if (b.tokens + elapsed * b.refillPerSec >= b.capacity) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  { capacity, refillPerSec }: { capacity: number; refillPerSec: number }
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(key) ?? {
    tokens: capacity,
    updatedAt: now,
    capacity,
    refillPerSec,
  };
  const elapsed = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.updatedAt = now;

  buckets.delete(key);
  buckets.set(key, b);
  while (buckets.size > MAX_BUCKETS) {
    buckets.delete(buckets.keys().next().value!);
  }

  if (b.tokens < 1) {
    const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
    return { allowed: false, retryAfterSec };
  }

  b.tokens -= 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Taille courante (tests / diagnostic). */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

// --- Journal des connexions ------------------------------------------------

const LOGIN_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const LOGIN_LOG_PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastLogPurge = 0;

/**
 * Ecrit une ligne du journal des connexions (email tronque a 320 car.) et
 * purge, au plus une fois par heure, les lignes de plus de 90 jours.
 */
export async function recordLogin(data: {
  userId: string | null;
  email: string;
  ip: string;
  success: boolean;
}): Promise<void> {
  await prisma.loginLog.create({
    data: { ...data, email: data.email.slice(0, 320), ip: data.ip.slice(0, 64) },
  });
  const now = Date.now();
  if (now - lastLogPurge > LOGIN_LOG_PURGE_INTERVAL_MS) {
    lastLogPurge = now;
    await prisma.loginLog.deleteMany({
      where: { createdAt: { lt: new Date(now - LOGIN_LOG_RETENTION_MS) } },
    });
  }
}

// --- Anti brute-force sur le login (persiste, delai progressif) -------------
//
// Le blocage ne porte JAMAIS sur l'e-mail seul : sinon n'importe qui
// connaissant l'adresse d'un compte pourrait en bloquer le proprietaire
// indefiniment (deni de service). On bloque :
//  - le couple (email, ip)  : 5 echecs -> 1, 2, 4... min (plafond 30 min) ;
//  - l'ip seule (spraying)  : 20 echecs tous comptes confondus -> idem.
// Un e-mail vise depuis de nombreuses IP n'est que RALENTI (delai artificiel
// sur chaque tentative), ce qui laisse le vrai proprietaire se connecter.

const FAILURE_WINDOW_MS = 15 * 60 * 1000; // fenetre d'observation des echecs
const PAIR_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;
// Seuil a partir duquel un compte est considere "sous attaque".
export const ACCOUNT_ATTACK_THRESHOLD = 10;
const ATTACK_SLOWDOWN_MS = 2000;

function progressiveLock(
  failures: { createdAt: Date }[],
  threshold: number
): number {
  if (failures.length < threshold) return 0;
  const over = failures.length - threshold;
  const penaltyMin = Math.min(30, Math.pow(2, over)); // 1,2,4,8,16,30
  const unlockAt = failures[0].createdAt.getTime() + penaltyMin * 60 * 1000;
  return Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
}

/**
 * Evalue une tentative de connexion. Renvoie :
 * - locked / retryAfterSec : refus avant meme de verifier le mot de passe ;
 * - slowdownMs : delai a appliquer a la reponse (compte sous attaque).
 */
export async function getLoginLockout(
  email: string,
  ip: string
): Promise<{ locked: boolean; retryAfterSec: number; slowdownMs: number }> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  // IP inconnue (app lancee hors server.mjs) : on ne bloque pas toute la
  // plateforme sur une IP partagee fictive.
  const ipKnown = ip !== "unknown";

  // Echecs depuis le dernier succes de CE couple (email, ip).
  const lastPairSuccess = await prisma.loginLog.findFirst({
    where: { success: true, email, ip, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const pairSince = lastPairSuccess?.createdAt ?? since;

  const [pairFailures, ipFailures, emailFailureCount] = await Promise.all([
    prisma.loginLog.findMany({
      where: { success: false, email, ip, createdAt: { gt: pairSince } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { createdAt: true },
    }),
    ipKnown
      ? prisma.loginLog.findMany({
          where: { success: false, ip, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: IP_MAX_FAILURES + 10,
          select: { createdAt: true },
        })
      : Promise.resolve([]),
    prisma.loginLog.count({
      where: { success: false, email, createdAt: { gte: since } },
    }),
  ]);

  const retryAfterSec = Math.max(
    progressiveLock(pairFailures, PAIR_MAX_FAILURES),
    progressiveLock(ipFailures, IP_MAX_FAILURES)
  );
  const slowdownMs =
    emailFailureCount >= ACCOUNT_ATTACK_THRESHOLD ? ATTACK_SLOWDOWN_MS : 0;

  return { locked: retryAfterSec > 0, retryAfterSec, slowdownMs };
}

/**
 * Comptes cibles par des echecs de connexion sur une periode (alerte admin).
 */
export async function getTargetedAccounts(sinceMs = 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - sinceMs);
  const rows = await prisma.loginLog.groupBy({
    by: ["email"],
    where: { success: false, createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
    having: { email: { _count: { gte: ACCOUNT_ATTACK_THRESHOLD } } },
    orderBy: { _count: { email: "desc" } },
    take: 20,
  });
  return Promise.all(
    rows.map(async (r) => {
      const ips = await prisma.loginLog.findMany({
        where: { success: false, email: r.email, createdAt: { gte: since } },
        distinct: ["ip"],
        select: { ip: true },
        take: 1000,
      });
      return {
        email: r.email,
        failures: r._count._all,
        distinctIps: ips.length,
        lastAttempt: r._max.createdAt,
      };
    })
  );
}
