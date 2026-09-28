import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Base SQLite et stockage TEMPORAIRES, partages par le serveur de test et les
// tests (jamais la base ou le stockage reels).
const dir = (process.env.WS_TEST_DIR ??= mkdtempSync(
  path.join(tmpdir(), "webstorage-test-")
));
const env = {
  WS_TEST_DIR: dir,
  DATABASE_URL: `file:${path.join(dir, "test.db")}`,
  STORAGE_DIR: path.join(dir, "storage"),
  SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
  MAX_UPLOAD_SIZE_BYTES: "30000000",
};
Object.assign(process.env, env);

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    env,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
