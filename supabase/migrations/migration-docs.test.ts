// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pinned Supabase CLI deployment command', () => {
  const docs = readFileSync(join(process.cwd(), 'docs', 'MIGRATIONS.md'), 'utf8');

  it('documents the one-command migration and production seed deployment', () => {
    expect(docs).toContain('supabase db push --include-all --include-seed');
    expect(docs).toContain('Supabase CLI `2.107.0`');
  });

  it('uses flags supported by the installed CLI', () => {
    const help = process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'supabase db push --help'],
          { encoding: 'utf8' },
        )
      : execFileSync('supabase', ['db', 'push', '--help'], { encoding: 'utf8' });
    expect(help).toContain('--include-all');
    expect(help).toContain('--include-seed');
  });
});
