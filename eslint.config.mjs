import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Informes generados por Unlighthouse (JS minificado de terceros): no es
    // código nuestro y ESLint no lee .gitignore en flat config, así que hay que
    // excluirlo aquí para que no ahogue el lint con miles de falsos positivos.
    ".unlighthouse/**",
  ]),
]);

export default eslintConfig;
