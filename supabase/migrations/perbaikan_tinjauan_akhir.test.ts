// @vitest-environment node
// Kontrak statis migrasi 202611040001 (perbaikan tinjauan akhir: KEAMANAN P1-1/P1-2/P2-1/P2-2/P2-3/P2-7,
// QA akses FO P1/P2, UI-04, tinjauan ulang CODEX-REVIEW P2-1/P2-3). Tidak mengeksekusi SQL; perilaku dibuktikan di scripts/lokal-rantai/skenario-tinjauan-akhir.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BERKAS = join(__dirname, '202611040001_perbaikan_tinjauan_akhir.sql');
const ROLLBACK = join(__dirname, '..', '..', 'docs', 'rollback-perbaikan-tinjauan-akhir-202611040001.sql');
const mentah = () => (existsSync(BERKAS) ? readFileSync(BERKAS, 'utf8') : '');
const sql = () => mentah().replace(/--[^\n]*/g, '');
const rollback = () => (existsSync(ROLLBACK) ? readFileSync(ROLLBACK, 'utf8').replace(/--[^\n]*/g, '') : '');
const badan = (teks: string, nama: string) =>
  teks.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';

describe('202611040001: kepala dan prasyarat', () => {
  it('kepala menyebut prasyarat, staging dahulu, dan WAJIB --atomic', () => {
    const kepala = mentah().split('\n').slice(0, 25).join('\n');
    expect(kepala).toMatch(/PRASYARAT/i);
    expect(kepala).toMatch(/terapkan hanya setelah staging lolos/i);
    expect(kepala).toContain('WAJIB --atomic');
    expect(kepala).toContain('docs/rollback-perbaikan-tinjauan-akhir-202611040001.sql');
  });

  it('menolak rantai tanpa 0011, 0013, 0014, dan 0015 tanpa mengubah data nyata', () => {
    const t = sql();
    expect(t).toContain('PRASYARAT:');
    for (const nama of [
      'fo_ambil_pengunjung(uuid)', 'kirim_saran_publik(text,text)', 'linimasa_pengaduan(uuid)', 'tangani_pengaduan(uuid)',
      'admin_atur_operator(uuid,boolean)', 'fo_antrean_daftar(date,uuid,integer,integer)',
      'rekap_ringkasan_dilayani(date,date,text,uuid,boolean)', 'rekap_pelayanan_inti(date,date,text,uuid)',
      'audit_perubahan()', 'staf_lingkup()', 'sesi_valid()',
    ]) {
      expect(t, nama).toContain(`to_regprocedure('public.${nama}')`);
    }
    expect(t).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE))/i);
    expect(t).not.toMatch(/^\s*(?:BEGIN|COMMIT);/im);
  });

  it('semua fungsi SECURITY DEFINER baru memakai search_path aman', () => {
    const t = sql();
    const definer = t.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/gi) ?? [];
    expect(definer.length).toBeGreaterThanOrEqual(9);
    for (const f of definer.filter((x) => /SECURITY DEFINER/.test(x))) {
      expect(f).toContain('SET search_path = pg_catalog, public');
    }
  });
});

describe('P1-1: fo_ambil_pengunjung', () => {
  it('FO non-Koordinator ditolak untuk kunjungan dalam jendela 7 hari yang bukan miliknya', () => {
    const b = badan(sql(), 'fo_ambil_pengunjung');
    expect(b).toContain('public.sesi_valid()');
    expect(b).toMatch(/v_role = 'front_office' AND NOT COALESCE\(v_koord, false\)/);
    expect(b).toContain("v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date");
    expect(b).toContain('k.tanggal >= v_hari - 7');
    expect(b).toContain('k.dibuat_oleh = v_id');
    expect(b).toMatch(/p\.penangan_id = v_id/);
    expect(b).toContain("'FORBIDDEN:");
    // Batas laju dan audit tetap.
    expect(b).toContain("INTERVAL '10 minutes'");
    expect(b).toContain("'fo_ambil_pengunjung', 'kunjungan'");
    expect(b).toContain('v_hari - 730');
  });
});

describe('P1-2: kirim_saran_publik hanya service_role', () => {
  it('dicabut dari anon/authenticated dan diberikan ke service_role', () => {
    const t = sql();
    expect(t).toMatch(/REVOKE ALL ON FUNCTION public\.kirim_saran_publik\(text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(t).toMatch(/GRANT EXECUTE ON FUNCTION public\.kirim_saran_publik\(text, text\) TO service_role;/);
    expect(t).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.kirim_saran_publik[^;]*\b(anon|authenticated)\b/);
  });

  it('route saran memakai service client, bukan klien sesi', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'api', 'saran', 'route.ts'), 'utf8');
    expect(route).toContain("from '@supabase/supabase-js'");
    expect(route).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(route).not.toContain("from '@/lib/supabase/server'");
  });
});

describe('Tinjauan ulang P2-3: penghitung laju saran bersama', () => {
  it('catat_laju_publik: hanya service_role, atomik (advisory lock), memakai anon_rate_limit, kunci hash', () => {
    const t = sql();
    const b = badan(t, 'catat_laju_publik');
    expect(b).toContain('SECURITY DEFINER');
    expect(b).toContain('pg_advisory_xact_lock');
    expect(b).toContain('public.anon_rate_limit');
    expect(b).toContain('r.user_id IS NULL');
    expect(b).toContain("p_kunci !~ '^[0-9a-f]{64}$'");
    expect(b).toContain("'MASUKAN_TIDAK_VALID:");
    expect(b).toMatch(/IF v_jumlah >= p_maks THEN\s+RETURN false;/);
    expect(t).toMatch(/REVOKE ALL ON FUNCTION public\.catat_laju_publik\(text, text, integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(t).toMatch(/GRANT EXECUTE ON FUNCTION public\.catat_laju_publik\(text, text, integer, integer\) TO service_role;/);
    expect(t).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.catat_laju_publik[^;]*\b(anon|authenticated)\b/);
  });

  it('route saran memakai penghitung DB 5 per 10 menit, fail-closed, tanpa Map lokal', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'api', 'saran', 'route.ts'), 'utf8');
    expect(route).toContain("rpc('catat_laju_publik'");
    expect(route).toContain('RATE_MAX = 5');
    expect(route).toContain('RATE_WINDOW_DETIK = 10 * 60');
    expect(route).toContain("createHash('sha256')");
    expect(route).toContain('status: 503');
    expect(route).not.toMatch(/new Map|rateBuckets/);
  });
});

describe('P2-1: pengaduan satu penangan ditegakkan di DB', () => {
  it('pemicu BEFORE UPDATE mengunci kolom kerja dan status milik penangan lain', () => {
    const t = sql();
    const b = badan(t, 'jaga_kolom_pengaduan');
    for (const kolom of ['batas_verifikasi', 'batas_penanganan', 'isi', 'layanan_id', 'jalur', 'sumber',
      'nomor_tiket', 'lampiran_path', 'pelapor_nama', 'pelapor_email', 'kontak']) {
      expect(b, kolom).toContain(`'${kolom}'`);
    }
    expect(b).toContain('auth.uid() IS NULL');
    expect(b).toContain("'KOLOM_TERKUNCI:");
    expect(b).toContain("'BUKAN_PENANGAN:");
    expect(b).toMatch(/v_role IS DISTINCT FROM 'admin'/);
    expect(b).not.toContain('penangan_id :=');
    expect(t).toMatch(/CREATE TRIGGER trg_pengaduan_kolom_kerja\s+BEFORE UPDATE ON public\.pengaduan/);
  });

  it('pemicu urut sebelum penjaga penangan (nama trigger diurutkan alfabet)', () => {
    expect('trg_pengaduan_kolom_kerja' < 'trg_pengaduan_penangan').toBe(true);
    expect('trg_pengaduan_anonim' < 'trg_pengaduan_kolom_kerja').toBe(true);
  });

  it('riwayat dari klien wajib status_baru = status pengaduan saat itu; RPC/pemicu (flag) lolos', () => {
    const t = sql();
    const b = badan(t, 'jaga_riwayat_status');
    expect(b).toContain("NEW.jenis = 'status'");
    expect(b).toContain("current_setting('lmh.penangan_rpc', true)");
    expect(b).toContain('NEW.status_baru IS DISTINCT FROM v_status');
    expect(b).toContain("'RIWAYAT_TIDAK_SESUAI:");
    expect(t).toMatch(/CREATE TRIGGER trg_riwayat_status\s+BEFORE INSERT ON public\.pengaduan_riwayat/);
  });

  it('RPC tangani/ambil_alih tidak diubah', () => {
    const t = sql();
    expect(badan(t, 'tangani_pengaduan')).toBe('');
    expect(badan(t, 'ambil_alih_pengaduan')).toBe('');
    expect(badan(t, 'jaga_penangan_pengaduan')).toBe('');
  });
});

describe('P2-2 + UI-04: linimasa dan daftar pengaduan', () => {
  it('linimasa memeriksa sesi_valid dan memberi id stabil per lampiran tanpa kunci', () => {
    const b = badan(sql(), 'linimasa_pengaduan');
    expect(b).toContain('public.sesi_valid()');
    expect(b).toContain("'SESI_TIDAK_SAH:");
    expect(b).toContain("'id', a.id, 'nama', a.nama_asli");
    expect(b).not.toMatch(/a\.kunci|lampiran_path|pelapor_|kontak/);
  });

  it('v_pengaduan_kerja tetap security_invoker dan menambah ada_bukti di akhir', () => {
    const t = sql();
    const v = t.match(/CREATE OR REPLACE VIEW public\.v_pengaduan_kerja[\s\S]*?;/)?.[0] ?? '';
    expect(v).toContain('security_invoker = true');
    expect(v).toMatch(/g\.penangan_sejak, g\.created_at, g\.updated_at,\s*\(g\.lampiran_path IS NOT NULL\) AS ada_bukti\s+FROM/);
    expect(t).toMatch(/GRANT SELECT ON public\.v_pengaduan_kerja TO authenticated;/);
  });
});

describe('P2-3 + QA P2: daftar FO', () => {
  it('FO non-Koordinator hanya tanggal [hari ini-7, hari ini+1] WIB pada kedua daftar', () => {
    const t = sql();
    for (const nama of ['fo_antrean_daftar', 'fo_kunjungan_daftar']) {
      const b = badan(t, nama);
      expect(b, nama).toContain('public.sesi_valid()');
      expect(b, nama).toContain("v_role = 'front_office' AND NOT COALESCE(v_koord, false)");
      expect(b, nama).toContain('p_tanggal < v_hari - 7 OR p_tanggal > v_hari + 1');
      expect(b, nama).toContain("'TANGGAL_DILUAR_BATAS:");
      expect(b, nama).not.toMatch(/kontak_hp|email|asal_instansi|keperluan|catatan|to_jsonb\([ktp]\)/i);
    }
  });

  it('fo_kunjungan_daftar 5 argumen: cari + status disaring sebelum paginasi; overload lama dibuang', () => {
    const t = sql();
    expect(t).toContain('DROP FUNCTION IF EXISTS public.fo_kunjungan_daftar(date, integer, integer);');
    const b = badan(t, 'fo_kunjungan_daftar');
    expect(b).toMatch(/p_cari text DEFAULT NULL,\s*p_status text DEFAULT NULL/);
    expect(b).toContain('char_length(v_cari) > 100');
    expect(b).toContain("'\\', '\\\\'");
    // total memakai saringan yang sama dengan halaman (sekali untuk count, sekali untuk halaman)
    expect(b.match(/\(v_status IS NULL OR k\.status = v_status\)/g)?.length).toBe(2);
    expect(b.match(/\(v_pola IS NULL OR k\.nama ILIKE v_pola OR EXISTS \(/g)?.length).toBe(2);
    expect(b.match(/l\.nama ILIKE v_pola/g)?.length).toBe(2);
    expect(t).toMatch(/GRANT EXECUTE ON FUNCTION public\.fo_kunjungan_daftar\(date, integer, integer, text, text\) TO authenticated;/);
  });
});

describe('QA P1 + P2: rekap', () => {
  it('rekap_pelayanan_inti memaksa unit fo untuk FO non-Koordinator; unit layanan = kosong', () => {
    const b = badan(sql(), 'rekap_pelayanan_inti');
    expect(b).toMatch(/v_role = 'front_office' AND NOT COALESCE\(v_koord, false\)/);
    expect(b).toContain("p_unit := 'fo'");
    expect(b).toMatch(/IF p_unit = 'layanan' THEN\s+RETURN;/);
    expect(b).toContain('RENTANG_TIDAK_VALID');
    expect(sql()).toMatch(/REVOKE ALL ON FUNCTION public\.rekap_pelayanan_inti\(date, date, text, uuid\) FROM PUBLIC, anon, authenticated;/);
  });

  it('ringkasan dilayani mengecualikan penangan NULL pada pembilang dan penyebut', () => {
    const b = badan(sql(), 'rekap_ringkasan_dilayani');
    expect(b).toContain('i.penangan_id IS NOT NULL');
    expect(b).toContain('s.penangan_id IS NOT NULL');
    expect(b).toContain("'saya', v_saya, 'total', v_total, 'persen'");
    expect(b).not.toMatch(/jsonb_agg|to_jsonb|kontak_hp|email/);
  });
});

describe('P2-7: operator', () => {
  it('audit petugas memuat operator_aktif; mematikan izin mengosongkan operator_default', () => {
    const t = sql();
    expect(t).toMatch(/CREATE TRIGGER trg_audit_petugas_ubah AFTER UPDATE OF role, aktif, username, layanan_id, nama, operator_aktif ON public\.petugas/);
    expect(t).toContain("public.audit_perubahan('id', 'nama', 'role', 'aktif', 'username', 'layanan_id', 'operator_aktif')");
    const b = badan(t, 'admin_atur_operator');
    expect(b).toContain('operator_default = CASE WHEN p_aktif THEN operator_default END');
    expect(b).toContain('public.sesi_valid()');
  });
});

describe('rollback manual', () => {
  it('ada, tanpa BEGIN/COMMIT, tanpa menghapus data, dan mengembalikan semua objek', () => {
    const r = rollback();
    expect(r).not.toBe('');
    expect(r).not.toMatch(/^\s*(?:BEGIN|COMMIT);/im);
    expect(r).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|COLUMN|SCHEMA))/i);
    expect(r).toContain('DROP TRIGGER IF EXISTS trg_pengaduan_kolom_kerja ON public.pengaduan;');
    expect(r).toContain('DROP TRIGGER IF EXISTS trg_riwayat_status ON public.pengaduan_riwayat;');
    expect(r).toContain('DROP FUNCTION IF EXISTS public.catat_laju_publik(text, text, integer, integer);');
    expect(r).toContain('DROP FUNCTION IF EXISTS public.fo_kunjungan_daftar(date, integer, integer, text, text);');
    expect(r).toMatch(/GRANT EXECUTE ON FUNCTION public\.kirim_saran_publik\(text, text\) TO anon, authenticated;/);
    expect(r).toContain("public.audit_perubahan('id', 'nama', 'role', 'aktif', 'username', 'layanan_id')");
    for (const nama of ['fo_ambil_pengunjung', 'linimasa_pengaduan', 'fo_antrean_daftar', 'fo_kunjungan_daftar',
      'rekap_pelayanan_inti', 'rekap_ringkasan_dilayani', 'admin_atur_operator']) {
      expect(badan(r, nama), nama).not.toBe('');
    }
    // v_pengaduan_kerja tanpa ada_bukti: CREATE OR REPLACE tidak bisa membuang kolom -> DROP VIEW lalu CREATE.
    expect(r).toContain('DROP VIEW IF EXISTS public.v_pengaduan_kerja;');
  });
});
