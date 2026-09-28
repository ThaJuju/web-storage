import { redirect } from "next/navigation";
import { SESSION_EXPIRED_PATH, getAuthenticatedUser } from "@/lib/session";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect(SESSION_EXPIRED_PATH);
  redirect("/folder/root");
}
