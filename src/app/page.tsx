import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  redirect("/folder/root");
}
