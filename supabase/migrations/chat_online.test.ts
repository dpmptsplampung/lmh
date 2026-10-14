// @vitest-environment node
// Kontrak statis migrasi Tahap C (C1-DB): 202610140009_chat_online (live chat = layanan online tercatat).
// Tidak mengeksekusi SQL; tidak menyentuh database. Uji perilaku DB: scripts/test-chat-online.mjs (transaksi di-ROLLBACK).
// Kontrak untuk UI: docs/analysis/FO-CHAT-KONTRAK-RPC.md (ikut diperiksa agar tidak menyimpang dari SQL).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';

const M9 = '202610140009_chat_online.sql';
const RB9 = 'rollback-chat-online-202610140009.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8');
const rapikan = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const m = sql.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan`);
  return m[0];
}
function ambilHak(sql: string, kata: 'REVOKE' | 'GRANT', fungsi: string): string[] {
  return [...sql.matchAll(new RegExp(`${kata}\\s[^;]*public\\.${fungsi}\\s*\\([^;]*;`, 'gi'))].map((m) => m[0]);
}

const raw9 = baca(M9);
const sql9 = stripSqlComments(raw9);
const rbRaw9 = bacaDocs(RB9);
const rb9 = stripSqlComments(rbRaw9);
const kontrak = bacaDocs('analysis', 'FO-CHAT-KONTRAK-RPC.md');

// [nama, argumen identitas, peran staf yang diizinkan]
const RPC_KLIEN = [
  ['chat_ambil', 'uuid, text', ['front_office', 'admin', 'petugas']],
  ['chat_teruskan', 'uuid, uuid, uuid, text', ['front_office', 'admin']],
  ['chat_selesai', 'uuid, uuid, text', ['front_office', 'admin', 'petugas']],
] as const;
const INTERNAL = [
  ['chat_ubah_sesi', 'uuid, text, uuid, uuid'],
  ['chat_pesan_sistem', 'uuid, text, text'],
  ['chat_buat_kunjungan', 'uuid, text, date'],
] as const;
const TRIGGER_FN = ['chat_sesi_jaga_rpc', 'chat_sesi_eskalasi_kunjungan', 'chat_pesan_eskalasi_kunjungan', 'guard_chat_sesi_staff_columns'] as const;
const KODE_GALAT = [
  'FORBIDDEN', 'SESI_TIDAK_SAH', 'NOT_FOUND', 'INVALID_STATUS', 'SUDAH_DIAMBIL', 'DIVERGENSI', 'ALASAN_WAJIB',
  'BUKAN_TAHAP_FO', 'BUKAN_PEMILIK', 'TOPIK_WAJIB', 'TOPIK_TIDAK_VALID', 'CATATAN_WAJIB', 'CATATAN_TERLALU_PANJANG',
  'LAYANAN_TIDAK_VALID', 'CHAT_HARUS_RPC', 'SALURAN_CHAT',
];

describe('C1-DB: berkas, urutan, pendaftaran', () => {
  it('tanpa BEGIN/COMMIT (migrasi & rollback), wajib --atomic, perintah dry-run di header', () => {
    expect(mengandungKontrolTransaksi(raw9)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw9)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw9)).toBe(true);
    expect(raw9).toContain(`apply-migration.mjs supabase/migrations/${M9} --atomic --dry-run`);
    expect(rbRaw9).toMatch(/--atomic --dry-run/);
  });

  it('terdaftar di FORWARD_MIGRATION_FILES, nama valid, sesudah 0008 (WP-24)', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M9);
    expect(M9).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    const semua = listMigrationFiles();
    expect(semua.indexOf(M9)).toBeGreaterThan(semua.indexOf('202610140005_fo_selaras_antrean.sql'));
    expect(semua.filter((f) => f.startsWith('202610140009_'))).toEqual([M9]);
  });

  it('penjaga prasyarat (DO) sebelum CREATE/ALTER apa pun; memeriksa model penanganan dan fungsi internal FO', () => {
    const pertamaDo = sql9.search(/DO \$\$/);
    expect(pertamaDo).toBeGreaterThanOrEqual(0);
    expect(pertamaDo).toBeLessThan(sql9.search(/CREATE|ALTER|UPDATE|INSERT/));
    expect(sql9).toMatch(/to_regclass\('public\.penanganan'\)/);
    expect(sql9).toMatch(/to_regprocedure\('public\.staf_wajib_sesi\(text\[\]\)'\)/);
    expect(sql9).toMatch(/kunjungan'::regclass AND a\.attname = 'chat_sesi_id'/);
  });

  it('tidak bergantung pada fo_sinkron_visit (di-DROP 0007) dan tidak mendefinisi ulang RPC FO / job', () => {
    expect(sql9).not.toMatch(/fo_sinkron_visit/);
    expect(sql9).not.toMatch(/FUNCTION\s+public\.(fo_\w+|layanan_\w+|admin_\w+|tandai_\w+|tutup_penanganan_tertinggal|terbit_tiket)\s*\(/i);
    expect(sql9).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|DROP[^;]*\bCASCADE\b/i);
    expect(sql9).not.toMatch(/INSERT\s+INTO\s+public\.visit/i);
  });

  it('RLS chat_sesi/chat_pesan TIDAK diubah (tanpa CREATE/DROP POLICY sama sekali)', () => {
    expect(sql9).not.toMatch(/\b(CREATE|DROP|ALTER)\s+POLICY\b/i);
    expect(sql9).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('C1-DB: skema', () => {
  it('chat_sesi.kunjungan_id FK kunjungan + indeks unik dua arah', () => {
    expect(rapikan(sql9)).toContain(
      'ADD COLUMN IF NOT EXISTS kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL');
    expect(sql9).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sesi_kunjungan\s+ON public\.chat_sesi \(kunjungan_id\) WHERE kunjungan_id IS NOT NULL/);
    expect(sql9).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_kunjungan_online_chat_sesi\s+ON public\.kunjungan \(chat_sesi_id\) WHERE asal = 'online'/);
  });
});

describe('C1-DB: fungsi dan hak', () => {
  it('semua fungsi baru/diubah SECURITY DEFINER dengan search_path terkunci', () => {
    for (const m of sql9.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)) {
      const f = ambilFungsi(sql9, m[1]);
      expect(f, m[1]).toMatch(/SECURITY DEFINER/);
      expect(f, m[1]).toMatch(/SET search_path = pg_catalog, public/);
    }
  });

  it.each(RPC_KLIEN)('%s(%s): REVOKE PUBLIC/anon/authenticated lalu GRANT authenticated; staf_wajib_sesi dengan peran tepat', (nama, args, peran) => {
    expect(ambilHak(sql9, 'REVOKE', nama).join(' ')).toContain(`public.${nama}(${args}) FROM PUBLIC, anon, authenticated`);
    expect(ambilHak(sql9, 'GRANT', nama)).toEqual([`GRANT EXECUTE ON FUNCTION public.${nama}(${args}) TO authenticated;`]);
    const f = ambilFungsi(sql9, nama);
    expect(f).toContain(`staf_wajib_sesi(ARRAY[${peran.map((p) => `'${p}'`).join(', ')}])`);
    expect(f).toMatch(/FROM public\.chat_sesi AS s WHERE s\.id = p_sesi_id FOR NO KEY UPDATE/);
    // Jam server: tidak ada parameter waktu.
    expect(f.split('RETURNS')[0]).not.toMatch(/timestamptz|\btime\b|\bdate\b/);
  });

  it.each(INTERNAL)('internal %s(%s): tanpa GRANT ke anon/authenticated', (nama, args) => {
    expect(ambilHak(sql9, 'REVOKE', nama).join(' ')).toContain(`public.${nama}(${args}) FROM PUBLIC, anon, authenticated`);
    for (const g of ambilHak(sql9, 'GRANT', nama)) expect(g).not.toMatch(/\b(anon|authenticated)\b/);
  });

  it.each(TRIGGER_FN)('fungsi trigger %s tidak bisa dipanggil klien', (nama) => {
    expect(ambilHak(sql9, 'REVOKE', nama).join(' ')).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(ambilHak(sql9, 'GRANT', nama)).toEqual([]);
  });

  it('flag lmh.chat_rpc selalu dinyalakan lalu dimatikan (berpasangan)', () => {
    const on = (sql9.match(/set_config\('lmh\.chat_rpc', 'on', true\)/g) ?? []).length;
    const off = (sql9.match(/set_config\('lmh\.chat_rpc', 'off', true\)/g) ?? []).length;
    expect(on).toBeGreaterThan(0);
    expect(on).toBe(off);
  });
});

describe('C1-DB: eskalasi dan penjaga', () => {
  it('trigger eskalasi AFTER INSERT/UPDATE OF status: kunjungan online + tahap FO chat menunggu', () => {
    expect(sql9).toMatch(/CREATE TRIGGER trg_chat_sesi_eskalasi_kunjungan\s+AFTER INSERT OR UPDATE OF status ON public\.chat_sesi/);
    const f = ambilFungsi(sql9, 'chat_sesi_eskalasi_kunjungan');
    expect(f).toMatch(/NEW\.status = 'eskalasi' AND NEW\.kunjungan_id IS NULL/);
    expect(rapikan(f)).toContain("VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.id)");
    const k = ambilFungsi(sql9, 'chat_buat_kunjungan');
    expect(k).toMatch(/'online', v_qr/);
    expect(k).toMatch(/FROM public\.pengunjung AS p WHERE p\.id = v_s\.pengunjung_id/);
    expect(k).toMatch(/AT TIME ZONE 'Asia\/Jakarta'/);
  });

  it('batas spam (review): kunjungan hanya bila sesi eskalasi punya pesan pengunjung; pesan pertama memicu pencatatan', () => {
    const f = ambilFungsi(sql9, 'chat_sesi_eskalasi_kunjungan');
    expect(rapikan(f)).toContain(
      "EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = NEW.id AND m.pengirim = 'pengunjung')");
    expect(sql9).toMatch(
      /CREATE TRIGGER trg_chat_pesan_eskalasi_kunjungan\s+AFTER INSERT ON public\.chat_pesan\s+FOR EACH ROW WHEN \(NEW\.pengirim = 'pengunjung'\)/);
    const p = ambilFungsi(sql9, 'chat_pesan_eskalasi_kunjungan');
    // Kunci baris sesi lalu periksa ulang: pesan/eskalasi serentak tidak menggandakan kunjungan.
    expect(p).toMatch(/FROM public\.chat_sesi AS s WHERE s\.id = NEW\.sesi_id FOR NO KEY UPDATE/);
    expect(p).toMatch(/v_s\.status = 'eskalasi' AND v_s\.kunjungan_id IS NULL/);
    expect(rapikan(p)).toContain("VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.sesi_id)");
  });

  it('backfill (review): hanya sesi dengan pesan pengunjung dan aktivitas <= 24 jam', () => {
    const blok = sql9.slice(sql9.lastIndexOf('DO $$'));
    expect(blok).toMatch(/WHERE s\.status IN \('eskalasi', 'aktif'\) AND s\.kunjungan_id IS NULL/);
    expect(blok).toMatch(/m\.pengirim = 'pengunjung'/);
    expect(blok).toMatch(/>= v_now - INTERVAL '24 hours'/);
  });

  it('penjaga kolom staf: BEFORE INSERT OR UPDATE, flag, galat CHAT_HARUS_RPC 42501, hanya bot->eskalasi/selesai tanpa flag', () => {
    expect(sql9).toMatch(/CREATE TRIGGER trg_chat_sesi_jaga_rpc\s+BEFORE INSERT OR UPDATE ON public\.chat_sesi/);
    const f = ambilFungsi(sql9, 'chat_sesi_jaga_rpc');
    expect(f).toMatch(/current_setting\('lmh\.chat_rpc', true\)/);
    expect(f).toMatch(/OLD\.status = 'bot' AND NEW\.status IN \('eskalasi', 'selesai'\) AND OLD\.kunjungan_id IS NULL/);
    expect(f).toMatch(/NEW\.status NOT IN \('bot', 'eskalasi'\)/);
    expect((f.match(/CHAT_HARUS_RPC/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(f).not.toMatch(/service_role/);
    const g = ambilFungsi(sql9, 'guard_chat_sesi_staff_columns');
    expect(g).toMatch(/current_setting\('lmh\.chat_rpc', true\)/);
  });
});

describe('C1-DB: RPC', () => {
  it('chat_ambil: atomik WHERE menunggu AND penangan_id IS NULL, SUDAH_DIAMBIL, petugas -> tahap layanan, admin ambil alih + audit', () => {
    const f = ambilFungsi(sql9, 'chat_ambil');
    expect(f).toMatch(/WHERE p\.id = v_p\.id AND p\.status = 'menunggu' AND p\.penangan_id IS NULL/);
    expect(f).toMatch(/SUDAH_DIAMBIL/);
    expect(f).toMatch(/'sudah_milik_anda', true/);
    expect(f).toMatch(/v_peran := 'layanan';\s+v_lyn\s+:= v_me_lyn;/);
    expect(f).toMatch(/batal_karena = 'diambil_alih'/);
    expect(f).toMatch(/ALASAN_WAJIB/);
    expect(f).toMatch(/'chat_ambil_alih'/);
    expect(f).toMatch(/IF v_me_role = 'admin' THEN\s+INSERT INTO public\.audit_log/);
    expect(f).not.toMatch(/terbit_tiket/);
  });

  it('chat_teruskan: tahap FO dieskalasi + topik FO + catatan <= 200, tahap layanan chat menunggu TANPA tiket, notifikasi, sesi pindah layanan', () => {
    const f = ambilFungsi(sql9, 'chat_teruskan');
    expect(f).toMatch(/fo_validasi_topik\(p_topik_id, NULL\)/);
    expect(f).toMatch(/fo_validasi_catatan\(p_catatan, 200\)/);
    expect(f).toMatch(/hasil = 'dieskalasi'/);
    expect(rapikan(f)).toContain("VALUES (v_s.kunjungan_id, v_tahap, 'layanan', p_layanan_id, 'chat', 'menunggu', p_sesi_id, v_me_id)");
    expect(f).not.toMatch(/terbit_tiket|tiket_antrean/);
    expect(f).toMatch(/queue_notifikasi\(/);
    expect(f).toMatch(/'type', 'chat_diteruskan'/);
    expect(f).toMatch(/chat_ubah_sesi\(p_sesi_id, 'eskalasi', NULL, p_layanan_id\)/);
    expect(f).toMatch(/punya_chat/);
    expect(f).toMatch(/BUKAN_TAHAP_FO/);
    expect(f).toMatch(/BUKAN_PEMILIK/);
  });

  it('chat_selesai: topik + catatan WAJIB (FO 200, layanan 1000), kunjungan & sesi selesai, pesan penutup survei tanpa URL', () => {
    const f = ambilFungsi(sql9, 'chat_selesai');
    expect(f).toMatch(/fo_validasi_topik\(p_topik_id, v_p\.layanan_id\)/);
    expect(f).toMatch(/fo_validasi_catatan\(p_catatan, CASE WHEN v_p\.peran_tahap = 'fo' THEN 200 ELSE 1000 END\)/);
    expect(f).toMatch(/UPDATE public\.kunjungan AS k SET status = 'selesai'/);
    expect(f).toMatch(/chat_ubah_sesi\(p_sesi_id, 'selesai', v_me_id\)/);
    expect(f).toMatch(/'penutup_survei'/);
    expect(f).not.toMatch(/https?:\/\//);
    expect(f).toMatch(/BUKAN_PEMILIK/);
  });

  it('boleh_penanganan / boleh_kunjungan: cabang chat petugas via chat_sesi.layanan_id', () => {
    expect(ambilFungsi(sql9, 'boleh_penanganan')).toMatch(/JOIN public\.chat_sesi AS s ON s\.id = k\.chat_sesi_id\s+WHERE k\.id = p_kunjungan AND k\.asal = 'online' AND s\.layanan_id = v_layanan/);
    expect(ambilFungsi(sql9, 'boleh_kunjungan')).toMatch(/k\.asal = 'online' AND public\.boleh_layanan\(s\.layanan_id\)/);
  });
});

describe('C1-DB: rollback', () => {
  it('menghapus semua objek baru', () => {
    for (const [nama, args] of [...RPC_KLIEN, ...INTERNAL]) {
      expect(rb9).toContain(`DROP FUNCTION IF EXISTS public.${nama}(${args});`);
    }
    for (const t of ['trg_chat_sesi_eskalasi_kunjungan', 'trg_chat_sesi_jaga_rpc']) {
      expect(rb9).toContain(`DROP TRIGGER IF EXISTS ${t} ON public.chat_sesi;`);
    }
    for (const i of ['uq_chat_sesi_kunjungan', 'uq_kunjungan_online_chat_sesi', 'idx_penanganan_chat_sesi', 'idx_penanganan_kotak_masuk_chat']) {
      expect(rb9).toContain(`DROP INDEX IF EXISTS public.${i};`);
    }
    expect(rb9).toContain('ALTER TABLE public.chat_sesi DROP COLUMN IF EXISTS kunjungan_id;');
    expect(rb9).toContain('DROP TRIGGER IF EXISTS trg_chat_pesan_eskalasi_kunjungan ON public.chat_pesan;');
    expect(rb9).toContain('DROP FUNCTION IF EXISTS public.chat_pesan_eskalasi_kunjungan();');
    expect(rb9).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it('penjaga urutan: menolak bila 202610140012 masih terpasang (DO di awal)', () => {
    const awal = rb9.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(rb9.search(/\bDROP\b/));
    expect(rb9).toMatch(/to_regprocedure\('public\.form_pendataan_dari_nama\(text\)'\) IS NOT NULL/);
    expect(rb9).toMatch(/RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140012/);
  });

  it.each([
    ['boleh_penanganan', '202610140003_fo_model_data.sql'],
    ['boleh_kunjungan', '202610090001_rbac_tahap1.sql'],
    ['guard_chat_sesi_staff_columns', '202610070001_chat_fix_guard_ringkas.sql'],
  ])('memulihkan %s persis seperti %s', (nama, asal) => {
    expect(rapikan(ambilFungsi(rb9, nama))).toBe(rapikan(ambilFungsi(stripSqlComments(baca(asal)), nama)));
  });
});

describe('C1-DB: dokumen kontrak', () => {
  it('memuat semua RPC dengan signature, kode galat, dan transisi status', () => {
    for (const [nama] of RPC_KLIEN) expect(kontrak).toContain(nama);
    expect(kontrak).toContain('chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL)');
    expect(kontrak).toContain('chat_teruskan(p_sesi_id uuid, p_layanan_id uuid, p_topik_id uuid, p_catatan text)');
    expect(kontrak).toContain('chat_selesai(p_sesi_id uuid, p_topik_id uuid, p_catatan text)');
    for (const k of KODE_GALAT) expect(kontrak, k).toContain(k);
    expect(kontrak).toMatch(/penutup_survei/);
    expect(kontrak).toMatch(/Transisi status/i);
  });

  it('setiap kode galat di kontrak muncul di SQL 0009 (kecuali yang dilempar helper 0004: staf_wajib_sesi, fo_validasi_*, fo_*)', () => {
    const dariHelper0004 = ['SALURAN_CHAT', 'SESI_TIDAK_SAH', 'TOPIK_WAJIB', 'TOPIK_TIDAK_VALID', 'CATATAN_WAJIB', 'CATATAN_TERLALU_PANJANG'];
    for (const k of KODE_GALAT.filter((x) => !dariHelper0004.includes(x))) {
      expect(sql9, k).toContain(`${k}:`);
    }
  });
});
