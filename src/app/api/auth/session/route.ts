import { type NextRequest } from "next/server";
import { json } from "@/lib/api";
import { getAuthenticatedUser } from "@/lib/session";

/**
 * GET /api/auth/session[?touch=1]
 * Etat de la session courante, utilise par le minuteur d'inactivite du
 * client. Sans `touch`, la verification ne prolonge PAS la session (sinon un
 * onglet inactif qui verifie la maintiendrait en vie). Avec `touch=1`
 * (heartbeat envoye tant que l'utilisateur est actif), lastSeenAt est
 * rafraichi.
 */
export async function GET(req: NextRequest) {
  const touch = req.nextUrl.searchParams.get("touch") === "1";
  const user = await getAuthenticatedUser({ touch });
  return json({ authenticated: !!user }, { status: user ? 200 : 401 });
}
