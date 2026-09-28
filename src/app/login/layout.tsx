import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";

/**
 * Deja connecte (session VALIDE, verifiee en base) -> pas de raison de revoir
 * /login. Un cookie simplement present mais invalide laisse afficher le
 * formulaire (le proxy ne redirige plus sur la seule presence du cookie).
 */
export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getAuthenticatedUser()) redirect("/folder/root");
  return children;
}
