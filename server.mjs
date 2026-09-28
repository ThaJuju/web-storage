// Serveur HTTP de l'application (remplace `next start` / `next dev`).
//
// Seul endroit qui voit la socket TCP : il calcule l'IP client de facon
// fiable et la transmet a l'app via l'en-tete interne x-webstorage-client-ip
// (toute valeur envoyee par le client est ecrasee). Sans cela, Next.js ne
// renseigne x-forwarded-for avec l'adresse de socket que si l'en-tete est
// ABSENT : un client pouvait donc choisir son IP (rate-limit contourne,
// journal falsifie).
//
//  - TRUST_PROXY=false (defaut) : app exposee directement -> adresse de socket.
//  - TRUST_PROXY=true : derriere UN reverse-proxy de confiance qui ajoute
//    l'IP du client a la fin de X-Forwarded-For (nginx:
//    proxy_add_x_forwarded_for) -> on prend la DERNIERE entree.
import { createServer } from "node:http";
import { isIP } from "node:net";
import next from "next";

const dev = process.argv.includes("--dev");
const port = parseInt(process.env.PORT || "3000", 10);
const trustProxy = process.env.TRUST_PROXY === "true";

// Signale a l'app que l'en-tete x-webstorage-client-ip est fiable.
process.env.WEBSTORAGE_CLIENT_IP_HEADER = "1";

function normalizeIp(raw) {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

function clientIp(req) {
  const socketIp = normalizeIp(req.socket.remoteAddress);
  if (trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    const list = (Array.isArray(fwd) ? fwd.join(",") : fwd ?? "").split(",");
    const last = normalizeIp(list[list.length - 1]);
    if (last) return last;
  }
  return socketIp ?? "unknown";
}

const app = next({ dev, port });
const handle = app.getRequestHandler();

await app.prepare();

createServer((req, res) => {
  const ip = clientIp(req);
  req.headers["x-webstorage-client-ip"] = ip;
  if (!trustProxy) {
    // Aucun proxy de confiance : on neutralise les en-tetes falsifiables.
    req.headers["x-forwarded-for"] = ip;
    delete req.headers["x-real-ip"];
  }
  handle(req, res);
}).listen(port, () => {
  console.log(
    `> web-storage pret sur le port ${port} (${
      dev ? "dev" : "production"
    }, TRUST_PROXY=${trustProxy})`
  );
});
