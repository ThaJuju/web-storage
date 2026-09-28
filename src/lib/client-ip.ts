import type { NextRequest } from "next/server";

let warned = false;

/**
 * IP du client, telle que calculee par server.mjs a partir de la socket
 * (ou du reverse-proxy de confiance si TRUST_PROXY=true). Les en-tetes
 * X-Forwarded-For / X-Real-IP envoyes par le client ne sont JAMAIS lus ici.
 *
 * Si l'app n'est pas lancee via server.mjs (ex. `next start` direct), l'IP
 * est inconnue : on renvoie "unknown" (les limites par IP deviennent
 * globales, ce qui reste sur) plutot qu'une valeur falsifiable.
 */
export function clientIp(req: NextRequest): string {
  if (process.env.WEBSTORAGE_CLIENT_IP_HEADER !== "1") {
    if (!warned) {
      warned = true;
      console.warn(
        "[web-storage] IP client inconnue : lancez l'app via server.mjs (npm start)."
      );
    }
    return "unknown";
  }
  return req.headers.get("x-webstorage-client-ip") ?? "unknown";
}
