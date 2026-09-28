import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";
import { USERS } from "./fixtures";

/**
 * Tests d'integration : base SQLite + STORAGE_DIR temporaires (cf.
 * vitest.config.mts), migrations appliquees, comptes de test crees, puis
 * serveur de PRODUCTION (server.mjs sur le build .next) lance sur un port
 * libre. Necessite `npm run build` au prealable.
 */
declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | null = null;

export default async function setup(project: TestProject) {
  if (!existsSync(".next/BUILD_ID")) {
    throw new Error("Build absent : lancer `npm run build` avant les tests d'integration.");
  }
  execSync("npx prisma migrate deploy", { env: process.env, stdio: "ignore" });

  const prisma = new PrismaClient();
  for (const u of Object.values(USERS)) {
    await prisma.user.create({
      data: {
        email: u.email,
        isAdmin: u.isAdmin,
        passwordHash: await bcrypt.hash(u.password, 4),
      },
    });
  }
  await prisma.$disconnect();

  const port = await freePort();
  server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), LISTEN_HOST: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout!.on("data", (d) => (output += d));
  server.stderr!.on("data", (d) => (output += d));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ok = await fetch(`${baseUrl}/login`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() > deadline || server.exitCode !== null) {
      throw new Error(`Le serveur de test n'a pas demarre :\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  project.provide("baseUrl", baseUrl);

  return async () => {
    server?.kill();
    rmSync(process.env.WS_TEST_DIR!, { recursive: true, force: true });
  };
}
