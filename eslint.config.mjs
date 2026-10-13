import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import lmh from "./eslint-rules/mutasi-tercek.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Plugin lokal `lmh` didaftarkan global agar direktif `eslint-disable lmh/...` di berkas mana pun
  // (termasuk test) tidak memicu "Definition for rule not found"; aturannya sendiri hanya aktif di bawah.
  { plugins: { lmh } },
  // Audit T2: mutasi Supabase harus dicek (UPDATE/DELETE lewat mutasiWajibBaris/mutasiBolehKosong,
  // INSERT/UPSERT/RPC hasilnya dikonsumsi). "error" + --max-warnings=0 = memblokir build.
  // Rancangan: docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.4.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/lib/supabase/mutate.ts"],
    rules: { "lmh/mutasi-tercek": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tooling/skills folders are not application code:
    ".opencode/**",
    ".superpowers/**",
    ".codex/**",
    ".github/prompts/**",
    // Artefak lokal `npm run test:coverage` (sudah di .gitignore), bukan kode aplikasi:
    "coverage/**",
  ]),
]);

export default eslintConfig;
