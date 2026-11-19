// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, '202611190005_ipro_gambar_atomik.sql'), 'utf8'));
const fungsi = (nama: string) => sql.match(new RegExp(`CREATE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? '';
describe('gambar dan penerbitan IPRO atomik', () => {
  it.each(['ipro_tambah_gambar', 'ipro_ubah_gambar', 'ipro_hapus_gambar', 'ipro_ubah_status'])(
    '%s memeriksa akses dan mengunci proyek sebelum mutasi', nama => {
      const f = fungsi(nama);
      expect(f).toContain('SECURITY DEFINER');
      expect(f).toContain('SET search_path = pg_catalog, public');
      expect(f).toContain('public.boleh_kelola_investasi()');
      expect(f).toMatch(/FROM public\.ipro_proyek AS p\s+WHERE p\.id = p_proyek_id FOR UPDATE/);
      expect(f.indexOf('FOR UPDATE')).toBeLessThan(f.search(/(?:INSERT INTO|UPDATE public|DELETE FROM)/));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nama}\\([^;]+FROM PUBLIC, anon, authenticated, service_role;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nama}\\([^;]+TO authenticated;`));
    });
  it('menegakkan batas satu FOILA dan dua belas PTSP di bawah lock', () => {
    const f = fungsi('ipro_tambah_gambar');
    expect(f).toContain("CASE WHEN v_proyek.sumber = 'foila' THEN 1 ELSE 12 END");
    expect(f).toContain('IF v_jumlah >= v_batas THEN');
    expect(f).toContain('v_jumlah = 0 OR coalesce(v_gambar.utama, false)');
    expect(f.indexOf('FOR UPDATE')).toBeLessThan(f.indexOf('SELECT count('));
    expect(f.indexOf('SELECT count(')).toBeLessThan(f.indexOf('UPDATE public.ipro_gambar'));
  });
  it('reset utama dan target berada dalam fungsi yang sama tanpa menelan kegagalan', () => {
    for (const nama of ['ipro_tambah_gambar', 'ipro_ubah_gambar']) {
      const f = fungsi(nama);
      expect(f).toContain('SET utama = false');
      expect(f).not.toMatch(/EXCEPTION\s+WHEN|\bCOMMIT\b/);
    }
    const f = fungsi('ipro_ubah_gambar');
    expect(f.indexOf('IF NOT FOUND THEN')).toBeLessThan(f.indexOf('SET utama = false'));
    expect(f).toContain('urutan = CASE WHEN p_data');
  });
  it('hapus utama terbit ditolak dan kunci R2 dikembalikan setelah DELETE', () => {
    const f = fungsi('ipro_hapus_gambar');
    expect(f).toContain("v_proyek.status = 'terbit'");
    expect(f).toContain("v_gambar.utama OR v_proyek.sumber = 'foila'");
    expect(f.indexOf("RAISE EXCEPTION 'SYARAT_TERBIT'")).toBeLessThan(f.indexOf('DELETE FROM'));
    expect(f).toContain("'kunci', v_gambar.kunci, 'kunci_mini', v_gambar.kunci_mini");
  });
  it('terbit mempertahankan versi optimistik dan memvalidasi di bawah lock', () => {
    const f = fungsi('ipro_ubah_status');
    expect(f).toContain('v_proyek.versi IS DISTINCT FROM p_versi');
    expect(f).toContain("RAISE EXCEPTION 'KONFLIK_VERSI'");
    expect(f.indexOf('FOR UPDATE')).toBeLessThan(f.indexOf('public.ipro_kekurangan_terbit('));
    expect(f).not.toMatch(/to_jsonb\(v_proyek\)/);
  });
  it('menutup penulisan gambar langsung dan bypass terbit lewat DML proyek', () => {
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.ipro_gambar FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('CREATE TRIGGER ipro_jaga_terbit AFTER INSERT OR UPDATE ON public.ipro_proyek');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ipro_kekurangan_terbit(uuid) FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain("to_regprocedure('public.investasi_ubah_status_minat(uuid,text,integer)')");
  });
  it('rollback mempertahankan data dan tidak membuka lagi mutasi yang rentan', () => {
    const rollback = stripSqlComments(readFileSync(join(process.cwd(), 'docs/rollback-ipro-gambar-atomik-202611190005.sql'), 'utf8'));
    expect(rollback).toContain('REVOKE ALL ON FUNCTION public.ipro_tambah_gambar');
    expect(rollback).not.toMatch(/DROP\s+(TABLE|SCHEMA)|TRUNCATE|DELETE FROM|GRANT\s+(INSERT|UPDATE|DELETE)/);
    expect(rollback).not.toContain('DROP TRIGGER');
  });
});
