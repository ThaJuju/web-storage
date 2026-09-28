/**
 * GET JSON cote client, sans jamais lever d'exception.
 * `res` vaut null en cas d'erreur reseau ; `data` vaut null si la reponse
 * n'est pas OK ou pas du JSON valide.
 */
export async function fetchJson<T>(
  url: string
): Promise<{ res: Response | null; data: T | null }> {
  const res = await fetch(url, { cache: "no-store" }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
  return { res, data };
}
