// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, '202611240001_investment_gallery_publik.sql'), 'utf8'));
const [tukar, angka] = sql.split('CREATE FUNCTION public.investasi_angka_publik');

it('pertukaran memakai hak staf dan mengunci urutan sebelum cek tetangga dan tulis', () => {
  expect(tukar).toMatch(/SECURITY INVOKER SET search_path = ''/);
  expect(tukar).toMatch(/SET lock_timeout = '2s'\s+AS \$\$/);
  expect(tukar).toMatch(/IF NOT COALESCE\(public\.boleh_kelola_investasi\(\), false\)/);
  expect(tukar).toMatch(/LOCK TABLE public\.investment_documents IN SHARE ROW EXCLUSIVE MODE;[\s\S]*ORDER BY urutan_tampil, id[\s\S]*abs\(v_posisi - v_posisi_tetangga\) <> 1[\s\S]*UPDATE public\.investment_documents/);
  expect(tukar).toMatch(/REVOKE ALL [^;]+ FROM PUBLIC, anon, authenticated;/);
  expect(tukar).toMatch(/GRANT EXECUTE [^;]+ TO authenticated;/);
});

it('agregat publik tunduk pada RLS dan hanya menghitung IPRO terbit, dokumen aktif, sektor dan wilayah', () => {
  expect(angka).toMatch(/STABLE SECURITY INVOKER SET search_path = ''/);
  expect(angka).not.toContain('lock_timeout');
  expect(angka).toContain("status = 'aktif'");
  expect(angka).toContain("p.status = 'terbit' AND p.sumber = 'ptsp'");
  expect(angka).toContain("count(DISTINCT nullif(btrim(p.sektor), ''))");
  expect(angka).toContain("count(DISTINCT nullif(btrim(p.kab_kota), ''))");
  expect(angka).not.toContain('nilai_investasi');
});
