// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../../vitest.config';

const testConfig = (config as {
  test?: { include?: string[]; exclude?: string[] };
}).test;

describe('Vitest discovery configuration', () => {
  it('only includes application and SQL contract tests', () => {
    expect(testConfig?.include).toEqual([
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'supabase/migrations/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ]);
    expect(testConfig?.include?.every(
      (pattern) =>
        pattern.startsWith('src/') || pattern.startsWith('supabase/migrations/'),
    )).toBe(true);
  });

  it('retains defaults and excludes hidden tooling and generated output', () => {
    expect(testConfig?.exclude).toEqual(expect.arrayContaining([
      ...configDefaults.exclude,
      '**/.opencode/**',
      '**/.superpowers/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ]));
  });
});

describe('baseline verification metadata', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
  };

  it('treats lint warnings as failures and provides the baseline gate', () => {
    expect(packageJson.scripts?.lint).toBe('eslint . --max-warnings=0');
    expect(packageJson.scripts?.['verify:baseline']).toBe(
      'npm run lint && npm run typecheck && npm test && npm run build',
    );
  });

  it('pins the supported Node 22 runtime', () => {
    const nvmrcPath = resolve(process.cwd(), '.nvmrc');

    expect(packageJson.engines?.node).toBe('>=22');
    expect(existsSync(nvmrcPath)).toBe(true);
    if (existsSync(nvmrcPath)) {
      expect(readFileSync(nvmrcPath, 'utf8').trim()).toBe('22');
    }
  });
});
