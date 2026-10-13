import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createRequire } from "node:module";

// eslint-plugin-react 7.x detecte la version de React via
// context.getFilename(), retire dans ESLint 10 : on la fournit explicitement
// (lue depuis le paquet installe pour rester synchronisee).
const reactVersion = createRequire(import.meta.url)("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { react: { version: reactVersion } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Client Prisma genere.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
