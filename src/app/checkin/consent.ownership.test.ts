// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('checkin consent ownership behavior', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/checkin/page.tsx'),
    'utf8',
  );

  it('only inserts consent when consentGiven is true and uses auth user id as subjek_ref', () => {
    expect(source).toMatch(/consentGiven/);
    expect(source).toMatch(/consent_log[\s\S]*insert/);
    expect(source).toMatch(/subjek_ref:\s*currentUserId/);
    expect(source).toMatch(/disetujui:\s*true/);
    expect(source).toMatch(/versi_kebijakan:\s*CONSENT_VERSION/);
    // Must guard insert on consent flag (not silent auto-insert without assertion)
    expect(source).toMatch(/if\s*\(\s*currentUserId\s*&&\s*consentGiven\s*\)|if\s*\(\s*consentGiven\s*&&\s*currentUserId\s*\)/);
  });
});
