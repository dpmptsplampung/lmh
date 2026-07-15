#!/usr/bin/env node
/**
 * Post-deploy / local smoke checks.
 *
 * Usage:
 *   BASE_URL=https://your-app.example npm run smoke
 *   BASE_URL=http://localhost:3000 npm run smoke
 *
 * If BASE_URL is unset, exits 0 after printing skip notice (safe for CI
 * without a running server).
 */

const base = (process.env.BASE_URL || "").replace(/\/$/, "");

if (!base) {
  console.log(
    "smoke: BASE_URL not set — skipping network checks.\n" +
      "  Example: BASE_URL=http://localhost:3000 npm run smoke",
  );
  process.exit(0);
}

const paths = [
  { path: "/api/health/live", expectStatus: 200 },
];

let failed = 0;

for (const { path, expectStatus } of paths) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== expectStatus) {
      console.error(`FAIL ${url} → ${res.status} (expected ${expectStatus})`);
      failed += 1;
      continue;
    }
    const body = await res.text();
    console.log(`OK   ${url} → ${res.status} ${body.slice(0, 120)}`);
  } catch (err) {
    console.error(`FAIL ${url} → ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`smoke: ${failed} check(s) failed`);
  process.exit(1);
}

console.log("smoke: all checks passed");
