// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
it('klaim memakai pemeriksa, antrean berbatas dan penerima tanpa rincian pemohon', () => {
  const sql = readFileSync(new URL('./202611090011_umkm_pemilik_integrasi.sql', import.meta.url), 'utf8');
  for (const token of ['umkm_private.aktor()', 'umkm_private.hak_pemilik(p_profil_id)',
    "'Asia/Jakarta'", 'generate_series(hari-29,hari', 'LIMIT 21', 'klaim AS MATERIALIZED',
    "WHEN jenis='klaim'", 'CREATE TRIGGER umkm_suka_pemilik']) expect(sql).toContain(token);
  const recipients = sql.slice(sql.indexOf('CREATE FUNCTION public.umkm_perusahaan_penerima('),
    sql.indexOf('REVOKE ALL ON ALL FUNCTIONS'));
  expect(recipients).toContain("jsonb_build_object('nama',p.nama,'dibuka_pada',n.dibuat_pada)");
  expect(recipients).not.toMatch(/pemohon_uid|no_hp|email|nomor['\"]/);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});
it('perbaikan G5: cabut kepemilikan, pemilik terdaftar, label jejak dan LEFT JOIN pengunjung', () => {
  const sql = readFileSync(new URL('./202611090011_umkm_pemilik_integrasi.sql', import.meta.url), 'utf8');
  const cabut = sql.slice(sql.indexOf('CREATE FUNCTION public.umkm_cabut_kepemilikan('));
  for (const token of ['umkm_private.aktor()', "m.status<>'disetujui'", "'cabut_kepemilikan'",
    'umkm_private.ada_kontak(p_alasan)', 'KONFLIK_OPERASI']) expect(cabut).toContain(token);
  expect(cabut.slice(0, cabut.indexOf('END $$;'))).not.toMatch(/no_hp|email|akun_uid,/);
  for (const token of ["'pemilik_terdaftar'", 'LIMIT 20', "'Akun tidak tersedia'",
    'LEFT JOIN public.pengunjung g ON g.auth_user_id=r.aktor_uid', "WHEN h.peran='pemilik' THEN 'Pemilik usaha'",
    "h.peran IN ('admin','petugas','front_office','pemilik')",
    'GRANT EXECUTE ON FUNCTION public.umkm_cabut_kepemilikan(uuid,integer,uuid,text) TO authenticated'])
    expect(sql).toContain(token);
});
