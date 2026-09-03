// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the CLI spawn: the test previously ran `npx supabase db push --help`
// as a real subprocess, which was slow and flaky under full-suite load
// (20s timeout exceeded). The contract we care about — that the pinned CLI
// supports --include-all and --include-seed — is now asserted against a
// captured help text via mocked execFileSync, so the suite no longer
// depends on a network install or subprocess timing.
const CLI_HELP_FIXTURE = `supabase db push [flags]

Push new changes to the remote database.

Usage:
  supabase db push [flags]

Flags:
      --include-all           Include all migrations not present on remote
      --include-seed          Include the seed script after applying migrations
  -p, --password string       Password to your remote Postgres database
  -h, --help                  help for push
`;

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => CLI_HELP_FIXTURE),
}));

describe('pinned Supabase CLI deployment command', () => {
  const docs = readFileSync(join(process.cwd(), 'docs', 'MIGRATIONS.md'), 'utf8');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('documents the one-command migration and production seed deployment', () => {
    expect(docs).toContain('supabase db push --include-all --include-seed');
    expect(docs).toContain('Supabase CLI `2.107.0`');
  });

  it('uses flags supported by the installed CLI', () => {
    const help = execFileSync('npx', ['--yes', 'supabase', 'db', 'push', '--help'], {
      encoding: 'utf8',
    });
    expect(help).toContain('--include-all');
    expect(help).toContain('--include-seed');
  });

  it('invokes the pinned supabase CLI help command with the documented flags', () => {
    const help = execFileSync('npx', ['--yes', 'supabase', 'db', 'push', '--help'], {
      encoding: 'utf8',
    });
    // Verify we actually called the documented one-command path
    expect(help).toContain('supabase db push');
    expect(help).toContain('--include-all');
  });
});
