import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { existsSync } from "node:fs";

// Uji *database.test.ts menjalankan rantai migrasi di PGlite, yang dipasang manual dengan
// `npm i --no-save @electric-sql/pglite` (sengaja tidak di package.json). Tanpa paket itu, misalnya di CI,
// uji tersebut tidak dijalankan; pre-push di mesin yang memasangnya tetap menjalankannya.
const adaPglite = existsSync(path.resolve(__dirname, "node_modules/@electric-sql/pglite/package.json"));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "supabase/migrations/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: [
      ...configDefaults.exclude,
      "**/.opencode/**",
      "**/.superpowers/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      ...(adaPglite ? [] : ["**/*.database.test.ts", "src/lib/umkm-katalog/database.test.ts"]),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "**/*.d.ts",
        // Rolldown 1.1.5 (remap v8) gagal mem-parse berkas ini saat coverage
        // ("Expected `from` but found `{`" pada `import type`). Wrapper tipis
        // service-role tanpa test sendiri — dikecualikan agar gate coverage
        // tidak gagal palsu. Lepas bila rolldown diperbarui.
        "src/lib/supabase/service.ts",
      ],
      thresholds: {
        lines: 35,
        functions: 25,
        branches: 28,
        statements: 33,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
