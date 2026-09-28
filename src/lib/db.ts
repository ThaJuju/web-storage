import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { sqliteUrl } from "./sqlite-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new PrismaLibSql(
    { url: sqliteUrl() },
    // Les dates ont ete ecrites en millisecondes epoch (INTEGER) par le
    // moteur de Prisma 6 : on garde ce format pour relire l'existant.
    { timestampFormat: "unixepoch-ms" }
  );
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
