// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = 'supabase/migrations/202611160001_lingkup_layanan_staf.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const fungsi = (nama: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${nama.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? '';

describe('kontrak lingkup layanan G2', () => {
  it('batch jawaban rekap memeriksa semua id serta audit lintas pembuat tanpa memperluas SELECT', () => {
    const f = fungsi('public.rekap_khusus_peta');
    expect(f).toContain('VOLATILE SECURITY DEFINER');
    expect(f).toContain('public.lingkup_layanan_saya()');
    expect(f).toContain('public.sesi_valid()');
    expect(f).toContain('pg_catalog.cardinality(p_penanganan), 0) > 500');
    expect(f).toContain('p.id IS NULL OR NOT (v_semua');
    expect(f).toContain("p.peran_tahap = 'layanan' AND p.layanan_id = v_layanan");
    expect(f).toContain('k.dibuat_oleh IS DISTINCT FROM v_me');
    expect(f).toContain("'lihat_data','rekap_khusus'");
    expect(f).toContain('INSERT INTO public.audit_log');
    expect(f).not.toContain('EXCEPTION WHEN');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.rekap_khusus_peta(uuid[]) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.rekap_khusus_peta(uuid[]) TO authenticated');
    expect(sql).not.toMatch(/GRANT SELECT[^;]*pendataan_khusus_jawaban/);
  });
  it('menyediakan lingkup terpusat dengan akun aktif dan sesi sah', () => {
    const helper = fungsi('public.lingkup_layanan_saya');
    expect(helper).toContain('RETURNS TABLE (semua boolean, layanan_id uuid)');
    expect(helper).toContain('public.staf_lingkup()');
    expect(helper).toContain('public.sesi_valid()');
    expect(helper).toContain("me.role IN ('admin', 'front_office')");
    expect(helper).not.toContain('koordinator');
  });

  it('menjaga prasyarat versi produksi sebelum mengganti fungsi', () => {
    expect(sql).toContain('PRASYARAT: fungsi akses 202611030015 dan rekap 202611040001 wajib tersedia');
    expect(sql).toContain("'202611030015:%'");
    expect(sql).toContain("'202611040001:%'");
  });

  it('kelima helper baca dan kedua rekap memakai sumber lingkup tunggal', () => {
    for (const nama of ['boleh_penanganan', 'boleh_kunjungan', 'boleh_baca_pendataan', 'boleh_tiket_baca',
      'boleh_baca_khusus', 'rekap_pelayanan_inti', 'rekap_ringkasan_dilayani']) {
      const f = fungsi(`public.${nama}`);
      expect(f, nama).toContain('public.lingkup_layanan_saya()');
      if (!['boleh_baca_pendataan', 'boleh_baca_khusus'].includes(nama)) {
        expect(f, nama).not.toMatch(/koordinator|staf_lingkup\(|p_penangan\s*=|p_petugas\s*=/);
      } else {
        expect(f, nama).toContain('me.koordinator');
        expect(f, nama).toContain('k.dibuat_oleh = me.id');
        expect(f, nama).not.toContain('WHERE s.semua');
      }
    }
    expect(fungsi('public.boleh_tiket_baca')).not.toContain('public.boleh_kunjungan(');
  });

  it('menjaga proyeksi dan populasi rekap dari definisi hidup 040001', () => {
    const lama = readFileSync('supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql', 'utf8');
    const inti = fungsi('public.rekap_pelayanan_inti');
    expect(inti.slice(0, inti.indexOf('DECLARE'))).toBe(
      lama.slice(lama.indexOf('CREATE OR REPLACE FUNCTION public.rekap_pelayanan_inti('),
        lama.indexOf('DECLARE', lama.indexOf('CREATE OR REPLACE FUNCTION public.rekap_pelayanan_inti('))));
    for (const bagian of ["p.hasil = 'dikembalikan'", "COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'",
      'NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)']) {
      expect(inti).toContain(bagian);
      expect(fungsi('public.rekap_ringkasan_dilayani')).toContain(bagian);
    }
    expect(fungsi('public.rekap_ringkasan_dilayani')).toContain('i.penangan_id IS NOT NULL');
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(boleh_sunting|pemilik_tiket|layanan_mulai|koordinator_ambil|boleh_data_pelayanan)/);
    expect(sql).not.toMatch(/CREATE POLICY|GRANT (?:ALL|UPDATE|INSERT|DELETE) ON TABLE/i);
  });

  it('modul nullable dan backfill memakai nama seed, tanpa UUID instalasi', () => {
    expect(sql).toContain("CHECK (modul IN ('umkm', 'investasi'))");
    expect(sql).toContain("WHERE nama = 'Matchmaking UMKM'");
    expect(sql).toContain("WHERE nama = 'Investment Gallery'");
    expect(sql).not.toMatch(/ADD COLUMN[^;]*modul[^;]*NOT NULL/);
    expect(fungsi('public.staf_modul')).toContain('public.lingkup_layanan_saya()');
  });

  it('seluruh pemeriksaan penanda UMKM diganti modul dan setter dihentikan', () => {
    for (const nama of ['umkm_private.aktor', 'umkm_private.aktor_hapus', 'umkm_private.laporan_statistik']) {
      expect(fungsi(nama)).toContain("public.staf_modul()='umkm'");
      expect(fungsi(nama)).not.toContain('pemeriksa_umkm');
    }
    for (const nama of ['public.umkm_atur_pemeriksa', 'umkm_private.mutasi']) {
      expect(fungsi(nama)).toContain('DIHENTIKAN:');
      expect(fungsi(nama)).not.toMatch(/UPDATE public\.petugas SET pemeriksa_umkm/);
    }
  });

  it('audit menerima tiket saja, memvalidasi hak baca dan hanya mencatat FO lintas pembuat', () => {
    const audit = fungsi('public.audit_lihat_data');
    expect(audit).toContain('public.audit_lihat_data(p_tiket uuid)');
    expect(audit).toContain('public.sesi_valid()');
    expect(audit).toContain('public.lingkup_layanan_saya()');
    expect(audit).toContain('pg_advisory_xact_lock');
    expect(audit).toContain("interval '1 minute'");
    expect(audit).toContain("v_role='front_office' AND v_pembuat IS DISTINCT FROM v_id");
    expect(audit).toContain("VALUES(auth.uid(), v_role, 'lihat_data'");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.audit_lihat_data/);
    expect(audit).not.toMatch(/kontak_hp|email|nama_pemohon/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.audit_lihat_data(uuid) FROM PUBLIC, anon, authenticated');
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('RPC pengambilan data mengaudit atomik, mencakup semua formulir dan draf dengan batas', () => {
    const f = fungsi('public.lihat_data_pelayanan');
    expect(f).toContain('PERFORM public.audit_lihat_data(p_tiket)');
    expect(f).toContain('SECURITY DEFINER');
    expect(f).toContain('SET search_path = pg_catalog, public');
    for (const tabel of ['pelayanan_oss', 'pelayanan_perizinan', 'pendataan_khusus_jawaban', 'pendataan_khusus_field', 'pendataan_khusus_draf']) {
      expect(f).toContain(`public.${tabel}`);
    }
    expect(f).toContain("'label', f.label");
    expect(f).toContain("'label_snapshot', j.label_snapshot");
    expect(f).toContain('LIMIT 1001');
    expect(f).toContain('> 1000');
    expect(f).toContain('> 1048576');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.lihat_data_pelayanan(uuid) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.lihat_data_pelayanan(uuid) TO authenticated');
  });

});
