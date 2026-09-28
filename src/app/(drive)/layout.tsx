import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";
import { DriveShell } from "@/components/DriveShell";

/**
 * Layout protege : la vraie frontiere de securite cote serveur. Toute page
 * sous ce groupe exige une session valide (le middleware ne fait qu'une
 * redirection UX en amont).
 */
export default async function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  return <DriveShell isAdmin={user.isAdmin}>{children}</DriveShell>;
}
