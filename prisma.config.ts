import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { sqliteUrl } from "./src/lib/sqlite-url";

// Configuration du CLI Prisma (migrate, generate...). L'URL relative de
// DATABASE_URL reste resolue par rapport a prisma/, comme avant Prisma 7.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Defaut identique a .env.example : `prisma generate` (postinstall) doit
    // fonctionner meme sans .env (CI, installation neuve).
    url: sqliteUrl(
      process.env.DATABASE_URL ?? "file:./dev.db",
      path.dirname(new URL(import.meta.url).pathname)
    ),
  },
});
