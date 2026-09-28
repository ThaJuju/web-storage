import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

/** Journal des connexions, reserve a l'admin (rendu cote serveur). */
export default async function LoginsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/folder/root");

  const logs = await prisma.loginLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="px-6 py-6">
      <h1 className="mb-1 text-lg font-semibold text-slate-100">
        Journal des connexions
      </h1>
      <p className="mb-6 text-sm text-slate-400">
        200 derniers événements d&apos;authentification.
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">E-mail</th>
              <th className="px-4 py-2.5 font-medium">IP</th>
              <th className="px-4 py-2.5 font-medium">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-slate-800/70">
                <td className="px-4 py-2.5 text-slate-400">
                  {formatDate(log.createdAt.toISOString())}
                </td>
                <td className="px-4 py-2.5 text-slate-200">{log.email}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                  {log.ip}
                </td>
                <td className="px-4 py-2.5">
                  {log.success ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      Succès
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                      Échec
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Aucune connexion enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
