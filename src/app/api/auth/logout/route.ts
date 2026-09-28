import { type NextRequest } from "next/server";
import { destroyCurrentSession } from "@/lib/session";
import { checkOrigin, error, json } from "@/lib/api";

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return error("Origine invalide", 403);
  // Supprime la session en base : une copie du cookie devient inutilisable.
  await destroyCurrentSession();
  return json({ ok: true });
}
