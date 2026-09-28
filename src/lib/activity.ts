/**
 * Horodatage de la derniere activite de l'utilisateur, PARTAGE entre les
 * onglets (localStorage) : un onglet laisse en arriere-plan ne doit pas
 * deconnecter celui sur lequel on travaille. Cote client uniquement.
 */
const KEY = "webstorage:lastActivity";
let local = Date.now();

/** Signale une activite (interaction, upload en cours, video en lecture...). */
export function markActivity(): void {
  const now = Date.now();
  if (now - local < 1000) return; // au plus une ecriture par seconde
  local = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // localStorage indisponible (navigation privee...) : activite locale seule.
  }
}

/** Derniere activite connue, tous onglets confondus. */
export function lastActivity(): number {
  let shared = 0;
  try {
    shared = Number(localStorage.getItem(KEY)) || 0;
  } catch {}
  return Math.max(local, shared);
}
