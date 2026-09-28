import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";

/** Section super admin : gestion des utilisateurs. Reservee aux admins. */
export default async function AdminUsersPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/folder/root");

  return <AdminUsersClient />;
}
