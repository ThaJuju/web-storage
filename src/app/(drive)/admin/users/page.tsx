import { redirect } from "next/navigation";
import { SESSION_EXPIRED_PATH, getAuthenticatedUser } from "@/lib/session";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";

/** Section super admin : gestion des utilisateurs. Reservee aux admins. */
export default async function AdminUsersPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect(SESSION_EXPIRED_PATH);
  if (!user.isAdmin) redirect("/folder/root");

  return <AdminUsersClient />;
}
