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
  // Aksesibilitas (keputusan pemilik 2026-11-04): plugin jsx-a11y sudah dibawa eslint-config-next
  // (hanya 6 aturan). Aturan tambahan ini aktif untuk kode aplikasi, bukan tes.
  // `control-has-associated-label` sengaja tidak diaktifkan: terlalu banyak positif palsu pada tombol ikon ber-aria-label.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-noninteractive-tabindex": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
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
    // Worktree sesi lain dan konfigurasi lokal Claude (bukan kode aplikasi):
    ".claude/**",
    ".github/prompts/**",
    // Artefak lokal `npm run test:coverage` (sudah di .gitignore), bukan kode aplikasi:
    "coverage/**",
  ]),
]);

export default eslintConfig;
