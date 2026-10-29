// @vitest-environment node
// Gerbang: semua berkas aplikasi memakai Cloudflare R2; tidak boleh ada pemakaian Supabase Storage di kode sumber.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function* berkas(dir: string): Generator<string> {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) yield* berkas(p);
    else if (/\.(ts|tsx)$/.test(nama) && !/\.test\.(ts|tsx)$/.test(nama) && !nama.endsWith('r2-test-adapter.ts')) yield p;
  }
}

describe('tanpa supabase.storage', () => {
  it('tidak ada .storage.from( di src/', () => {
    const pelanggar = [...berkas(join(process.cwd(), 'src'))].filter((p) => /\.storage\s*\.from\(|\bstorage\s*\.from\(/.test(readFileSync(p, 'utf8')));
    expect(pelanggar).toEqual([]);
  });
});
