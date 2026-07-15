// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat consent ownership behavior', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/chat/page.tsx'),
    'utf8',
  );

  it('requires consentGiven and binds subjek_ref to auth/pengunjung ownership (not bare anon)', () => {
    expect(source).toMatch(/consentGiven/);
    expect(source).toMatch(/consent_log[\s\S]*insert/);
    expect(source).toMatch(/disetujui:\s*true/);
    expect(source).toMatch(/versi_kebijakan:\s*CONSENT_VERSION/);
    expect(source).toMatch(/if\s*\(\s*!consentGiven\s*\)|if\s*\(\s*consentGiven\s*\)/);
    // Must not insert subjek_ref: 'anon' as permanent path
    expect(source).not.toMatch(/subjek_ref:\s*['"]anon['"]/);
  });
});
