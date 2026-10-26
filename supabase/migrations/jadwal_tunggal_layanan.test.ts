// @vitest-environment node
//
// Kontrak statis migrasi 202610270002 (Fase 1: satu jadwal per Layanan, hari libur global, arsip dan
// saklar antrean menutup gerbang tiket/reservasi). Tes ini hanya membaca teks SQL; tidak ada SQL yang
// dieksekusi ke database.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610270002_jadwal_tunggal_layanan.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

/** Seluruh definisi `CREATE OR REPLACE FUNCTION public.<nama>(` sampai `END $$;` / `$$;` penutupnya. */
function ambilFungsi(nama: string): string {
  const mulai = bare.indexOf(`CREATE OR REPLACE FUNCTION public.${nama}(`);
  expect(mulai, `fungsi ${nama} ada`).toBeGreaterThanOrEqual(0);
  const buka = bare.indexOf('$$', mulai);
  const tutup = bare.indexOf('$$', buka + 2);
  expect(tutup, `fungsi ${nama} tertutup`).toBeGreaterThan(buka);
  return bare.slice(mulai, tutup + 2);
}

describe('202610270002_jadwal_tunggal_layanan migration', () => {
  it('is_layanan_buka_jadwal menolak layanan arsip dan hari libur sebelum pola mingguan', () => {
    const f = ambilFungsi('is_layanan_buka_jadwal');
    expect(f).toMatch(/p_layanan_id uuid,\s+p_tanggal date,\s+p_jam time DEFAULT NULL/);
    expect(f).toMatch(/RETURNS boolean/);
    expect(f).toMatch(/aktif = true/);
    expect(f).toMatch(/FROM public\.hari_libur/);
    const posAktif = f.indexOf('aktif = true');
    const posLibur = f.indexOf('FROM public.hari_libur');
    const posPengecualian = f.indexOf('FROM public.jadwal_pengecualian');
    const posStandby = f.indexOf('FROM public.jadwal_standby');
    expect(posAktif).toBeLessThan(posLibur);
    expect(posLibur).toBeLessThan(posPengecualian);
    expect(posPengecualian).toBeLessThan(posStandby);
    expect(f.indexOf('FROM public.layanan')).toBeLessThan(posLibur);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
  });

  it('jadwal_berikutnya disalin tanpa perubahan', () => {
    const f = ambilFungsi('jadwal_berikutnya');
    expect(f).toMatch(/v_limit date := p_dari_tanggal \+ 60/);
    expect(f).toMatch(/public\.is_layanan_buka_jadwal\(p_layanan_id, v, NULL\)/);
  });

  it('layanan_sudah_tutup_untuk menggabungkan batas global dan jam_selesai layanan', () => {
    const f = ambilFungsi('layanan_sudah_tutup_untuk');
    expect(f).toMatch(/p_layanan_id uuid,\s+p_waktu timestamptz DEFAULT now\(\)/);
    expect(f).toMatch(/RETURNS boolean/);
    expect(f).toMatch(/\bSTABLE\b/);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
    expect(f).toMatch(/public\.layanan_sudah_tutup\(p_waktu\)/);
    expect(f).toMatch(/p_waktu AT TIME ZONE 'Asia\/Jakarta'/);
    expect(f).toMatch(/EXTRACT\(ISODOW FROM/);
    expect(f).toMatch(/FROM public\.jadwal_standby/);
    expect(f).toMatch(/aktif = true/);
    expect(f).toMatch(/jam_selesai/);
    expect(f).toMatch(/NOT FOUND|IF NOT FOUND|IS NULL/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.layanan_sudah_tutup_untuk\(uuid, timestamptz\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_sudah_tutup_untuk\(uuid, timestamptz\) TO authenticated/);
  });

  it('fo_eskalasi dan admin_alihkan memakai batas tutup per layanan', () => {
    const eskalasi = ambilFungsi('fo_eskalasi');
    const alihkan = ambilFungsi('admin_alihkan');
    expect(eskalasi).toMatch(/layanan_sudah_tutup_untuk\(p_layanan_id\)/);
    expect(alihkan).toMatch(/layanan_sudah_tutup_untuk\(p_layanan_tujuan\)/);
    for (const f of [eskalasi, alihkan]) {
      expect(f).not.toMatch(/IF public\.layanan_sudah_tutup\(\) THEN/);
      expect(f).toMatch(/RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l\.nama\s+USING ERRCODE = 'P0001'/);
      expect(f).toMatch(/LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini \(libur\/di luar jadwal\/diarsipkan\)/);
      expect(f.indexOf('is_layanan_buka_jadwal')).toBeLessThan(f.indexOf('layanan_sudah_tutup_untuk'));
      expect(f.indexOf('layanan_sudah_tutup_untuk')).toBeLessThan(f.indexOf('public.terbit_tiket('));
    }
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.fo_eskalasi\(uuid, uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.fo_eskalasi\(uuid, uuid, uuid, text\) TO authenticated/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.admin_alihkan\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_alihkan\(uuid, uuid, text\) TO authenticated/);
  });

  it('reservasi_buat tidak lagi menolak akhir pekan untuk loket', () => {
    const f = ambilFungsi('reservasi_buat');
    const cek = f.match(/IF[^\n]*EXTRACT\(ISODOW FROM p_tanggal\) IN \(6, 7\)[^\n]*THEN/);
    expect(cek).not.toBeNull();
    expect(cek![0]).toMatch(/v_tujuan = 'bertemu_seseorang'/);
    expect(f.match(/ISODOW/g)).toHaveLength(1);
    expect(f).toMatch(/FROM public\.hari_libur/);
    expect(f).toMatch(/TANGGAL_TIDAK_VALID: kantor libur pada tanggal tersebut/);
    expect(f).toMatch(/public\.is_layanan_buka_jadwal\(p_layanan_id, p_tanggal, NULL\)/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.reservasi_buat\(text, date, uuid, text, text, time\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.reservasi_buat\(text, date, uuid, text, text, time\) TO authenticated/);
  });

  it('v_antrian_loket memakai saklar punya_antrean, bukan tipe', () => {
    const view = bare.match(/CREATE OR REPLACE VIEW public\.v_antrian_loket AS([\s\S]*?);/i)?.[1];
    expect(view).toBeDefined();
    expect(view).toMatch(/WHERE service\.punya_antrean = true\s+AND service\.aktif = true/);
    expect(view).not.toMatch(/tipe\s*=\s*'konsultatif'/);
    const kolom = [...view!.matchAll(/\bAS (layanan_id|layanan_nama|antre_count|dilayani_count|estimasi_durasi_menit|estimasi_tunggu_total_menit|sample_count)\b/g)].map((m) => m[1]);
    expect(kolom).toEqual(['layanan_id', 'layanan_nama', 'antre_count', 'dilayani_count', 'estimasi_durasi_menit', 'estimasi_tunggu_total_menit', 'sample_count']);
    expect(view).toMatch(/service\.tipe,/);
    expect(bare).toMatch(/REVOKE ALL\s+ON public\.v_antrian_loket FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_antrian_loket TO anon, authenticated/);
  });

  it('layanan baru mendapat jadwal default Senin–Jumat 08:00–15:30', () => {
    const f = ambilFungsi('layanan_isi_jadwal_default');
    expect(f).toMatch(/RETURNS trigger/);
    expect(f).toMatch(/INSERT INTO public\.jadwal_standby \(layanan_id, hari, jam_mulai, jam_selesai, aktif\)/);
    expect(f).toMatch(/generate_series\(1, 5\)/);
    expect(f).toMatch(/time '08:00'/);
    expect(f).toMatch(/time '15:30'/);
    expect(f).toMatch(/ON CONFLICT \(layanan_id, hari\) DO NOTHING/);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_layanan_jadwal_default ON public\.layanan/);
    expect(bare).toMatch(/CREATE TRIGGER trg_layanan_jadwal_default\s+AFTER INSERT ON public\.layanan\s+FOR EACH ROW EXECUTE FUNCTION public\.layanan_isi_jadwal_default\(\)/);
  });

  it('jadwal_standby tidak boleh melewati jam_tutup_layanan', () => {
    const f = ambilFungsi('jadwal_standby_batas_tutup');
    expect(f).toMatch(/RETURNS trigger/);
    expect(f).toMatch(/NEW\.jam_selesai > public\.jam_tutup_layanan\(\)/);
    expect(f).toMatch(/NEW\.jam_mulai >= NEW\.jam_selesai/);
    expect(f).toMatch(/RAISE EXCEPTION 'JADWAL_TIDAK_VALID: [^']*'[\s\S]*?USING ERRCODE = '22023'/);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_jadwal_standby_batas_tutup ON public\.jadwal_standby/);
    expect(bare).toMatch(/CREATE TRIGGER trg_jadwal_standby_batas_tutup\s+BEFORE INSERT OR UPDATE ON public\.jadwal_standby\s+FOR EACH ROW EXECUTE FUNCTION public\.jadwal_standby_batas_tutup\(\)/);
  });

  it('tidak destruktif dan tidak menyentuh baris layanan/jadwal yang ada', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|DROP\s+(TABLE|COLUMN)/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\.layanan\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\.jadwal_standby\b/i);
    expect(bare).not.toMatch(/\bINSERT\s+INTO\s+public\.layanan\b/i);
    expect(bare).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  it('terdaftar di manifest', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(NAMA_FILE);
  });
});
