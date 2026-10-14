// @vitest-environment node
// Penjaga WP-24: `visit` kini ARSIP BACA-SAJA (migrasi 202610140007: tak pernah ditulis lagi, trigger efek mati).
// Kode aplikasi tidak boleh lagi membaca atau mendengarkan perubahan tabel itu: bacaan harus pindah ke
// kunjungan / tiket_antrean / penanganan. Tes ini memindai sumber (bukan tes perilaku) agar pembaca baru tidak
// menyusup kembali.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) hasil.push(...berkasSumber(p));
    else if (/\.(ts|tsx)$/.test(nama) && !/\.test\.(ts|tsx)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/** Buang komentar baris dan blok agar penjelasan "visit = arsip" tidak terhitung sebagai pembaca. */
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const POLA_BACA_VISIT = [
  /\.from\(\s*['"`]visit['"`]\s*\)/, // supabase.from('visit')
  /table:\s*['"`]visit['"`]/, // useRealtimeRefetch / postgres_changes pada tabel visit
  /\.rpc\(\s*['"`][^'"`]*visit[^'"`]*['"`]/, // rpc fo_sinkron_visit dsb. (dihapus di 0007)
];

describe('visit = arsip baca-saja (WP-24)', () => {
  const berkas = berkasSumber(SRC);

  it('memindai berkas sumber', () => {
    expect(berkas.length).toBeGreaterThan(100);
  });

  it.each(POLA_BACA_VISIT.map((p) => [String(p), p] as const))(
    'tidak ada pembaca/pendengar tabel visit di src (pola %s)',
    (_nama, pola) => {
      const pelanggar = berkas.filter((f) => pola.test(tanpaKomentar(readFileSync(f, 'utf8'))));
      expect(pelanggar.map((f) => f.replace(SRC, 'src'))).toEqual([]);
    },
  );
});
