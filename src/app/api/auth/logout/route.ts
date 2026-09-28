import { type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { checkOrigin, error, json } from "@/lib/api";

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return error("Origine invalide", 403);
  const session = await getSession();
  session.destroy();
  return json({ ok: true });
}
