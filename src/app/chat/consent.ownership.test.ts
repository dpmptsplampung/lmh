// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sejak refaktor G6 logika persetujuan tersebar: ChatKlien.tsx (kotak centang + baris yang dikirim), bagian tampilan,
// hook sesi, dan lapisan data (insert consent_log). Sumber yang dibaca = gabungan teks semuanya (bukan berkas uji).
const polaSumber = /\.tsx?$/;
const bukanUji = (n: string) => polaSumber.test(n) && !/\.test\.tsx?$/.test(n);
const bacaSemua = (dir: string) =>
  readdirSync(join(process.cwd(), dir)).filter(bukanUji).map((n) => readFileSync(join(process.cwd(), dir, n), 'utf8')).join('\n');

describe('chat consent ownership behavior', () => {
  const source = [
    readFileSync(join(process.cwd(), 'src/app/chat/ChatKlien.tsx'), 'utf8'),
    bacaSemua('src/app/chat/_bagian'),
    bacaSemua('src/app/chat/_hook'),
    readFileSync(join(process.cwd(), 'src/lib/data/chat-pengunjung.ts'), 'utf8'),
  ].join('\n');

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
