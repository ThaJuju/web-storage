// Constantes partagees client/serveur (pas de secret ici).

// Deconnexion automatique apres 30 min d'inactivite. Source unique : le
// serveur expire la session (lastSeenAt) et le client s'aligne dessus.
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
