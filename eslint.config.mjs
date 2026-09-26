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
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // scripts/ is dev tooling (data import, scraping) - not in production bundle.
    // Has CommonJS require() calls and `any` types that don't fit src/ strict rules.
    // CI/quality gates should validate src/ only.
    "scripts/**",
  ]),
]);

export default eslintConfig;
