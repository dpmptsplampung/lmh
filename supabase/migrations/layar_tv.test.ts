// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

// 202611030012 = layar TV: nama/urutan khusus layar, tabel kejadian panggilan_layar
// (Realtime, baca publik hari ini WIB), panggil_tiket mencatat setiap panggilan.
const BERKAS = '202611030012_layar_tv.sql';
const ROLLBACK = '../../docs/rollback-layar-tv-202611030012.sql';

function baca(relatif: string) {
  return readFileSync(join(MIGRATIONS_DIR, relatif), 'utf8');
}

function kode(sql: string) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

function fungsi(sql: string, nama: string) {
  const definisi = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;`, 'i'));
  expect(definisi, `definisi ${nama}`).not.toBeNull();
  return definisi![0];
}

function view(sql: string, nama: string) {
  const definisi = sql.match(new RegExp(`CREATE (?:OR REPLACE )?VIEW public\\.${nama}[\\s\\S]*?;`, 'i'));
  expect(definisi, `definisi view ${nama}`).not.toBeNull();
  return definisi![0];
}

describe('202611030012 layar TV', () => {
  const sql = baca(BERKAS);
  const k = kode(sql);

  it('PRASYARAT hanya pada objek dari migrasi yang sudah diterapkan, tanpa kontrol transaksi', () => {
    const prasyarat = k.slice(0, k.indexOf('ALTER TABLE'));
    for (const rpc of [
      'public.staf_saya()',
      'public.boleh_layanan(uuid)',
      'public.panggil_tiket(uuid)',
      'public.get_my_role()',
      'public.validate_layar_token(text)',
      'extensions.gen_random_bytes(integer)',
    ]) {
      expect(prasyarat).toContain(`to_regprocedure('${rpc}')`);
    }
    expect(prasyarat).toContain("to_regclass('public.layar_token')");
    for (const kolom of [
      'layanan.tampil_di_layar',
      'layanan.nama',
      'tiket_antrean.nomor_display',
      'tiket_antrean.status',
      'layar_token.token',
      'layar_token.aktif',
    ]) {
      expect(prasyarat).toContain(`'${kolom}'`);
    }
    expect(prasyarat).toContain("to_regclass('public.v_layar_antrian')");
    expect(prasyarat).toMatch(/RAISE EXCEPTION 'PRASYARAT:/);
    // Tidak bergantung pada rantai Fase 1-6 yang belum diterapkan.
    expect(k).not.toMatch(/diarsipkan_at|layanan_status_hari_ini|staf_lingkup|v_antrian_loket/);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('kolom nama_layar dan urutan_layar dengan CHECK yang disepakati', () => {
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS nama_layar text/);
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS urutan_layar smallint/);
    expect(k).toMatch(/nama_layar IS NULL OR \(\s*nama_layar = pg_catalog\.btrim\(nama_layar\)\s*AND pg_catalog\.char_length\(nama_layar\) BETWEEN 1 AND 40\s*\)/);
    expect(k).toMatch(/urutan_layar IS NULL OR urutan_layar BETWEEN 1 AND 9999/);
    // Tulis tetap lewat RLS Admin yang ada: tidak ada policy/GRANT kolom baru pada layanan.
    expect(k).not.toMatch(/CREATE POLICY \w+ ON public\.layanan\b/);
    expect(k).not.toMatch(/GRANT UPDATE[^;]*?ON (TABLE )?public\.layanan\b/);
  });

  it('v_layar_antrian mempertahankan kolom lama dan menambah kolom baru di akhir', () => {
    const v = view(k, 'v_layar_antrian');
    const urut = [
      'AS layanan_id',
      'AS layanan_nama',
      'l.tipe',
      'AS antre_count',
      'AS dilayani_count',
      'AS nomor_sedang_dilayani',
      'AS nomor_display_dilayani',
      'AS estimasi_durasi_menit',
      'AS estimasi_tunggu_total_menit',
      'l.nama_layar',
      'l.urutan_layar',
      'AS nama_tampil',
    ];
    let posisi = -1;
    for (const bagian of urut) {
      const i = v.indexOf(bagian, posisi + 1);
      expect(i, bagian).toBeGreaterThan(posisi);
      posisi = i;
    }
    expect(v).toMatch(/COALESCE\(l\.nama_layar, l\.nama\)\s+AS nama_tampil/);
    expect(v).toMatch(/WHERE l\.aktif = true AND l\.tampil_di_layar = true/);
    expect(k).toMatch(/GRANT SELECT ON public\.v_layar_antrian TO anon, authenticated/);
  });

  it('tabel panggilan_layar: RLS hari ini WIB, klien hanya SELECT lima kolom, tanpa tulis klien', () => {
    expect(k).toMatch(/CREATE TABLE IF NOT EXISTS public\.panggilan_layar \(/);
    for (const kolom of ['id', 'layanan_id', 'tiket_id', 'nomor_display', 'label', 'dibuat_at']) {
      expect(k).toMatch(new RegExp(`\\n\\s+${kolom}\\s+(uuid|text|timestamptz)`));
    }
    expect(k).toMatch(/REFERENCES public\.layanan\(id\) ON DELETE CASCADE/);
    expect(k).toMatch(/REFERENCES public\.tiket_antrean\(id\) ON DELETE CASCADE/);
    expect(k).toMatch(/ALTER TABLE public\.panggilan_layar ENABLE ROW LEVEL SECURITY/);
    expect(k).toMatch(/REVOKE ALL ON TABLE public\.panggilan_layar FROM PUBLIC, anon, authenticated/);
    expect(k).toMatch(
      /GRANT SELECT \(id, layanan_id, nomor_display, label, dibuat_at\) ON public\.panggilan_layar TO anon, authenticated/,
    );
    expect(k).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*?ON (TABLE )?public\.panggilan_layar TO (anon|authenticated)/);
    expect(k).not.toMatch(/GRANT SELECT ON (TABLE )?public\.panggilan_layar TO/);
    const policy = k.match(/CREATE POLICY panggilan_layar_baca_hari_ini[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toMatch(/FOR SELECT TO anon, authenticated/);
    expect(policy).toMatch(
      /dibuat_at >= \(pg_catalog\.date_trunc\('day', pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\) AT TIME ZONE 'Asia\/Jakarta'\)/,
    );
    expect(k).not.toMatch(/CREATE POLICY \w+ ON public\.panggilan_layar\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(k).toMatch(/CREATE INDEX IF NOT EXISTS idx_panggilan_layar_dibuat_at ON public\.panggilan_layar \(dibuat_at\)/);
    expect(k).toMatch(/CREATE INDEX IF NOT EXISTS idx_panggilan_layar_tiket ON public\.panggilan_layar \(tiket_id, dibuat_at DESC\)/);
  });

  it('panggilan_layar masuk publikasi supabase_realtime secara idempoten', () => {
    expect(k).toMatch(/pubname = 'supabase_realtime'[\s\S]*?tablename = 'panggilan_layar'/);
    expect(k).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.panggilan_layar/);
  });

  it('panggil_tiket: perilaku lama + satu kejadian per panggilan, penjaga 1 detik mengembalikan nomor', () => {
    const f = fungsi(k, 'panggil_tiket');
    expect(f).toMatch(/RETURNS text/);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
    // Perilaku lama.
    expect(f).toMatch(/public\.staf_saya\(\)/);
    expect(f).toMatch(/ERRCODE = '42501'/);
    expect(f).toMatch(/t\.status = 'menunggu'/);
    expect(f).toMatch(/IF NOT FOUND THEN\s+RETURN NULL;/);
    expect(f).toMatch(/NOT public\.boleh_layanan\(v_layanan_id\)/);
    expect(f).toMatch(/pg_notify\(\s*'nomor_dipanggil'/);
    // Kunci baris tiket agar penjaga 1 detik tidak berlomba.
    expect(f).toMatch(/FOR UPDATE OF t/);
    expect(f).toMatch(/interval '1 second'/);
    expect(f).toMatch(/INSERT INTO public\.panggilan_layar \(layanan_id, tiket_id, nomor_display, label\)/);
    expect(f).toMatch(/COALESCE\(l\.nama_layar, l\.nama\)/);
    // Panggilan yang ditahan penjaga tetap sukses bagi petugas: nomor dikembalikan, bukan NULL.
    const sesudahNotFound = f.slice(f.indexOf('IF NOT FOUND'));
    expect(sesudahNotFound.match(/RETURN NULL/g)).toHaveLength(1);
    expect(f.trim().endsWith('END $$;')).toBe(true);
    expect(f).toMatch(/RETURN v_nomor_display;\s*END \$\$;$/);
    expect(k).toMatch(/REVOKE ALL ON FUNCTION public\.panggil_tiket\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(k).toMatch(/GRANT EXECUTE ON FUNCTION public\.panggil_tiket\(uuid\) TO authenticated, service_role/);
  });

  it('token layar: DEFAULT 8 angka acak kriptografis, format lama tetap sah, validasi memangkas spasi', () => {
    const baru = fungsi(k, 'layar_token_baru');
    expect(baru).toMatch(/extensions\.gen_random_bytes\(6\)/);
    expect(baru).toMatch(/% 100000000/);
    expect(baru).toMatch(/lpad\([\s\S]*?, 8, '0'\)/);
    expect(baru).not.toMatch(/\brandom\(\)/);
    expect(k).toMatch(/GRANT EXECUTE ON FUNCTION public\.layar_token_baru\(\) TO authenticated, service_role/);
    expect(k).toMatch(/ALTER TABLE public\.layar_token ALTER COLUMN token SET DEFAULT public\.layar_token_baru\(\)/);
    expect(k).toMatch(/CHECK \(token ~ '\^\[0-9\]\{8\}\$' OR token ~ '\^\[0-9a-f\]\{32\}\$'\) NOT VALID/);

    const v = fungsi(k, 'validate_layar_token');
    expect(v).toMatch(/RETURNS boolean/);
    expect(v).toMatch(/STABLE SECURITY DEFINER/);
    expect(v).toMatch(/token = pg_catalog\.btrim\(p_token\) AND aktif = true/);
    // Keputusan PM: tanpa pembatas tebakan di DB (tanpa tabel/INSERT tambahan).
    expect(v).not.toMatch(/INSERT|check_anon_rate|request\.headers/);
    expect(k).toMatch(/GRANT EXECUTE ON FUNCTION public\.validate_layar_token\(text\) TO anon, authenticated/);
  });

  it('retensi: satu job pg_cron harian membersihkan panggilan > 1 hari, idempoten', () => {
    const f = fungsi(k, 'layar_bersihkan');
    expect(f).toMatch(/DELETE FROM public\.panggilan_layar WHERE dibuat_at < pg_catalog\.now\(\) - interval '1 day'/);
    expect(k).toMatch(/REVOKE ALL ON FUNCTION public\.layar_bersihkan\(\) FROM PUBLIC, anon, authenticated/);
    expect(k).toMatch(/cron\.unschedule\(job\.jobid\) FROM cron\.job AS job WHERE job\.jobname = 'layar_bersihkan'/);
    expect(k).toMatch(/cron\.schedule\('layar_bersihkan', '5 17 \* \* \*', 'SELECT public\.layar_bersihkan\(\)'\)/);
  });

  it('tidak ada DELETE tanpa WHERE, DROP TABLE, atau TRUNCATE', () => {
    expect(k).not.toMatch(/\bTRUNCATE\b/i);
    expect(k).not.toMatch(/\bDROP TABLE\b/i);
    expect(k).not.toMatch(/DELETE FROM public\.\w+\s*(;|'\))/);
  });
});

describe('rollback 202611030012', () => {
  const sql = baca(ROLLBACK);
  const k = kode(sql);

  it('tanpa kontrol transaksi agar lolos --atomic', () => {
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('mencabut job, publikasi, tabel, kolom, dan memulihkan panggil_tiket serta v_layar_antrian', () => {
    expect(k).toMatch(/cron\.unschedule\(job\.jobid\) FROM cron\.job AS job WHERE job\.jobname = 'layar_bersihkan'/);
    expect(k).toMatch(/DROP FUNCTION IF EXISTS public\.layar_bersihkan\(\)/);
    expect(k).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.panggilan_layar/);
    expect(k).toMatch(/DROP TABLE IF EXISTS public\.panggilan_layar/);
    expect(k).toMatch(/DROP VIEW IF EXISTS public\.v_layar_antrian/);
    expect(view(k, 'v_layar_antrian')).not.toMatch(/nama_layar|urutan_layar|nama_tampil/);
    expect(k).toMatch(/GRANT SELECT ON public\.v_layar_antrian TO anon, authenticated/);
    const f = fungsi(k, 'panggil_tiket');
    expect(f).not.toMatch(/panggilan_layar|nama_layar/);
    expect(f).toMatch(/pg_notify/);
    expect(k).toMatch(/GRANT EXECUTE ON FUNCTION public\.panggil_tiket\(uuid\) TO authenticated, service_role/);
    expect(k).toMatch(/DROP COLUMN IF EXISTS nama_layar/);
    expect(k).toMatch(/DROP COLUMN IF EXISTS urutan_layar/);
    // Token: DEFAULT dan validasi lama dipulihkan; token 8 angka yang sudah dibuat tetap sah (cocok persis).
    expect(k).toMatch(/ALTER COLUMN token SET DEFAULT replace\(gen_random_uuid\(\)::text, '-', ''\)/);
    expect(k).toMatch(/DROP CONSTRAINT IF EXISTS layar_token_format_check/);
    expect(k).toMatch(/DROP FUNCTION IF EXISTS public\.layar_token_baru\(\)/);
    const val = fungsi(k, 'validate_layar_token');
    expect(val).toMatch(/STABLE SECURITY DEFINER/);
    expect(val).toMatch(/WHERE token = p_token AND aktif = true/);
    expect(k).toMatch(/GRANT EXECUTE ON FUNCTION public\.validate_layar_token\(text\) TO anon, authenticated/);
    expect(k.indexOf('SET DEFAULT replace')).toBeLessThan(k.indexOf('DROP FUNCTION IF EXISTS public.layar_token_baru()'));
    // View dibuat ulang SEBELUM kolom dibuang agar tidak ada ketergantungan tersisa.
    expect(k.indexOf('DROP VIEW IF EXISTS public.v_layar_antrian')).toBeLessThan(k.indexOf('DROP COLUMN IF EXISTS nama_layar'));
  });
});
