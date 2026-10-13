// @vitest-environment node
// Kontrak statis migrasi 202610140001_sesi_staf (tidak mengeksekusi SQL; tidak menyentuh database).
// Spec: docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §5 (K1). Rollback: docs/rollback-sesi-staf-202610140001.sql.
// Simulator logika di bawah mencerminkan matriks keputusan sesi_status(); urutan cabang SQL diperiksa terhadap simulator.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610140001_sesi_staf.sql';
const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari SQL yang sudah bebas komentar. */
function ambilFungsi(sql: string, nama: string): string {
  const m = sql.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan`);
  return m[0];
}

/** Pernyataan `REVOKE`/`GRANT` yang menyebut fungsi tertentu. */
function ambilHak(sql: string, kata: 'REVOKE' | 'GRANT', fungsi: string): string {
  const m = sql.match(new RegExp(`${kata}\\s[^;]*public\\.${fungsi}\\s*\\([^;]*;`, 'i'));
  if (!m) throw new Error(`${kata} ${fungsi} tidak ditemukan`);
  return m[0];
}

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const rollbackRaw = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-sesi-staf-202610140001.sql'), 'utf8');
const rollback = stripSqlComments(rollbackRaw);

const FUNGSI_KLIEN = ['sesi_status', 'sesi_valid', 'daftarkan_sesi', 'ping_sesi', 'akhiri_sesi'] as const;
const FUNGSI_INTERNAL = ['sesi_klaim_id', 'sesi_idle_menit', 'sesi_tunggal_aktif'] as const;
const SEMUA_FUNGSI = [...FUNGSI_INTERNAL, ...FUNGSI_KLIEN];

// ---------------------------------------------------------------------------------------------------------------
// Simulator logika (cermin sesi_status / sesi_idle_menit / sesi_tunggal_aktif / bendera tutup di ping_sesi)
// ---------------------------------------------------------------------------------------------------------------
type StatusSesi = 'bukan_staf' | 'transisi' | 'tidak_terdaftar' | 'digantikan' | 'idle' | 'ok';
interface Baris {
  sessionId: string;
  lastSeen: number; // ms epoch
  aktivitasAt: number;
}
interface Masukan {
  uid: string | null;
  peran: string | null; // get_my_role()
  klaim: string | null; // sesi_klaim_id() (sudah divalidasi UUID)
  baris: Baris | null;
  flagAktif: boolean; // sesi_tunggal_aktif()
  idleMenit: number; // sesi_idle_menit()
  sekarang: number;
}
const PERAN_STAF = ['admin', 'petugas', 'front_office'];

function sesiStatus(m: Masukan): StatusSesi {
  if (m.uid === null || m.peran === null || !PERAN_STAF.includes(m.peran)) return 'bukan_staf';
  if (m.baris === null) return m.flagAktif ? 'tidak_terdaftar' : 'transisi';
  if (m.klaim === null) return 'tidak_terdaftar';
  if (m.klaim !== m.baris.sessionId) return 'digantikan';
  const batas = m.sekarang - m.idleMenit * 60_000;
  if (m.baris.lastSeen <= batas || m.baris.aktivitasAt <= batas) return 'idle';
  return 'ok';
}
const sesiValid = (m: Masukan) => ['bukan_staf', 'transisi', 'ok'].includes(sesiStatus(m));

function parseIdle(v: string | null): number {
  if (v !== null && /^[0-9]{1,4}$/.test(v.trim())) {
    const n = Number(v.trim());
    if (n >= 5 && n <= 1440) return n;
  }
  return 120;
}
function parseFlag(v: string | null): boolean {
  const t = (v ?? '').trim().toLowerCase();
  if (t === '') return false;
  return !['false', '0', 'off', 'no', 'tidak', 'nonaktif'].includes(t);
}

const WIB_MS = 7 * 3_600_000;
/** Saat tutup terakhir (ms epoch) dan bendera tutup, mengikuti ping_sesi (WIB, tanpa DST). */
function tutup(dibuat: number, sekarang: number, jamTutupMenit: number): boolean {
  const hariIniWib = Math.floor((sekarang + WIB_MS) / 86_400_000) * 86_400_000; // 00:00 WIB hari ini, dalam skala WIB
  let batasWib = hariIniWib + jamTutupMenit * 60_000;
  if (sekarang + WIB_MS < batasWib) batasWib -= 86_400_000;
  return dibuat < batasWib - WIB_MS;
}
const wib = (iso: string) => Date.parse(`${iso}+07:00`);

const SID_A = '11111111-1111-4111-8111-111111111111';
const SID_B = '22222222-2222-4222-8222-222222222222';
const NOW = wib('2026-10-14T10:00:00');
const dasar: Masukan = {
  uid: 'u1',
  peran: 'front_office',
  klaim: SID_A,
  baris: { sessionId: SID_A, lastSeen: NOW - 60_000, aktivitasAt: NOW - 60_000 },
  flagAktif: false,
  idleMenit: 120,
  sekarang: NOW,
};

describe('Sesi staf: atomik, idempoten, hanya menyentuh objek miliknya', () => {
  it('tanpa BEGIN/COMMIT (file maupun rollback) dan terdeteksi sebagai pembuat fungsi (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610140001_sesi_staf\.sql --atomic --dry-run/);
  });

  it('versi lebih besar dari semua migrasi lain dan nama berpola benar', () => {
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    const lain = listMigrationFiles().filter((n) => n !== BERKAS && n.slice(0, 12) > BERKAS.slice(0, 12));
    expect(lain).toEqual([]);
  });

  it('daftar pernyataan: hanya tabel sesi_staf, fungsi sesi_*/daftarkan/ping/akhiri, dan dua baris site_settings', () => {
    const label = pecahPernyataan(sql).map(
      (p: string) =>
        rapikan(p).match(
          /^(DO|CREATE TABLE IF NOT EXISTS [\w.]+|COMMENT ON (?:TABLE|COLUMN) [\w.]+|ALTER TABLE [\w.]+ ENABLE ROW LEVEL SECURITY|REVOKE ALL ON (?:TABLE|FUNCTION) [\w.]+|GRANT (?:ALL|EXECUTE) ON (?:TABLE|FUNCTION) [\w.]+|INSERT INTO [\w.]+|CREATE OR REPLACE FUNCTION [\w.]+)/,
        )?.[1] ?? `TAK DIKENAL: ${rapikan(p).slice(0, 80)}`,
    );
    expect(label.filter((l: string) => l.startsWith('TAK DIKENAL'))).toEqual([]);
    const objek = new Set(label.map((l: string) => l.match(/public\.\w+/)?.[0] ?? l));
    const diizinkan = new Set([
      'DO',
      'public.sesi_staf',
      'public.site_settings',
      ...SEMUA_FUNGSI.map((f) => `public.${f}`),
    ]);
    for (const o of objek) expect(diizinkan, String(o)).toContain(o);
    expect(label.filter((l: string) => l === 'INSERT INTO public.site_settings')).toHaveLength(1);
  });

  it('idempoten: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, tanpa DROP/ALTER lain/UPDATE/DELETE', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.sesi_staf/);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(sql).not.toMatch(/CREATE\s+FUNCTION/i);
    expect(sql).not.toMatch(/\bDROP\s+/i);
    expect(sql).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX|\bCREATE\s+TRIGGER|\bCREATE\s+POLICY/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    const alter = [...sql.matchAll(/ALTER\s+TABLE\s+([\w.]+)\s+([A-Z ]+)/gi)].map((m) => `${m[1]} ${rapikan(m[2])}`);
    expect(alter).toEqual(['public.sesi_staf ENABLE ROW LEVEL SECURITY']);
    // UPDATE/DELETE hanya pada sesi_staf (di dalam fungsi), tidak pernah pada tabel lain
    for (const m of sql.matchAll(/\b(?:UPDATE(?!\s+SET\b)|DELETE\s+FROM)\s+([\w.]+)/gi)) expect(m[1]).toBe('public.sesi_staf');
    // INSERT hanya ke sesi_staf dan site_settings
    for (const m of sql.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi)) expect(['public.sesi_staf', 'public.site_settings']).toContain(m[1]);
  });

  it('penjaga prasyarat di awal: jam_tutup_layanan, get_my_role, site_settings, kolom keterangan', () => {
    const doBlok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/to_regprocedure\('public\.jam_tutup_layanan\(\)'\)/);
    expect(doBlok).toMatch(/to_regprocedure\('public\.get_my_role\(\)'\)/);
    expect(doBlok).toMatch(/to_regclass\('public\.site_settings'\)/);
    expect(doBlok).toMatch(/attname = 'keterangan'/);
    expect(sql.search(/DO \$\$/)).toBeLessThan(sql.search(/CREATE TABLE/));
  });
});

describe('Sesi staf: tabel sesi_staf', () => {
  const tabel = sql.match(/CREATE TABLE IF NOT EXISTS public\.sesi_staf \([\s\S]*?\);/)![0];

  it('kolom, PK user_id -> auth.users ON DELETE CASCADE, session_id uuid NOT NULL, waktu NOT NULL DEFAULT now()', () => {
    expect(rapikan(tabel)).toMatch(/user_id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/);
    expect(rapikan(tabel)).toMatch(/session_id uuid NOT NULL,/);
    for (const kolom of ['dibuat_at', 'last_seen', 'aktivitas_at']) {
      expect(rapikan(tabel)).toContain(`${kolom} timestamptz NOT NULL DEFAULT now()`);
    }
  });

  it('RLS aktif TANPA policy; hak tabel dicabut dari PUBLIC/anon/authenticated dan hanya service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.sesi_staf ENABLE ROW LEVEL SECURITY;/);
    expect(sql).not.toMatch(/POLICY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.sesi_staf FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT ALL ON TABLE public\.sesi_staf TO service_role;/);
    expect(sql).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE\s+public\.sesi_staf\s+TO\s+[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
  });
});

describe('Sesi staf: hak eksekusi dan SECURITY DEFINER', () => {
  it.each([...SEMUA_FUNGSI])('%s: SECURITY DEFINER, search_path terkunci, CREATE OR REPLACE', (nama) => {
    const f = ambilFungsi(sql, nama);
    expect(f).toMatch(/^CREATE OR REPLACE FUNCTION/);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public\s/);
  });

  it.each([...SEMUA_FUNGSI])('%s: REVOKE dari PUBLIC, anon, authenticated lebih dulu; anon tidak pernah diberi EXECUTE', (nama) => {
    expect(ambilHak(sql, 'REVOKE', nama)).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/);
    // Peka huruf besar: "public." pada nama fungsi bukan grantee PUBLIC.
    expect(ambilHak(sql, 'GRANT', nama)).not.toMatch(/\banon\b|\bPUBLIC\b/);
    expect(sql.search(new RegExp(`REVOKE[^;]*public\\.${nama}\\s*\\(`))).toBeLessThan(
      sql.search(new RegExp(`GRANT[^;]*public\\.${nama}\\s*\\(`)),
    );
  });

  it.each([...FUNGSI_KLIEN])('%s: GRANT hanya ke authenticated dan service_role', (nama) => {
    expect(rapikan(ambilHak(sql, 'GRANT', nama))).toMatch(/TO authenticated, service_role;$/);
  });

  it.each([...FUNGSI_INTERNAL])('%s (internal): GRANT hanya ke service_role (klien tidak dapat memanggil)', (nama) => {
    expect(rapikan(ambilHak(sql, 'GRANT', nama))).toMatch(/TO service_role;$/);
  });

  it('tanda tangan: ping_sesi(boolean) bergaransi default true; lainnya tanpa argumen; tidak ada overload ganda', () => {
    expect(sql).toMatch(/FUNCTION public\.ping_sesi\(p_aktif boolean DEFAULT true\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ping_sesi\(boolean\)/);
    const nama = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
    expect(new Set(nama).size).toBe(nama.length);
    expect(nama.sort()).toEqual([...SEMUA_FUNGSI].sort());
  });
});

describe('Sesi staf: klaim JWT session_id', () => {
  const f = ambilFungsi(sql, 'sesi_klaim_id');

  it("dibaca dari auth.jwt() ->> 'session_id' dan hanya UUID berbentuk valid yang dicast (selain itu NULL)", () => {
    expect(f).toMatch(/auth\.jwt\(\) ->> 'session_id'/);
    expect(f).toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/);
    expect(f).toMatch(/RETURN NULL;/);
  });

  it('tidak membaca auth.sessions di mana pun', () => {
    expect(sql).not.toMatch(/auth\.sessions/i);
  });

  it('Auth Hook proyek (set_user_role_claim) hanya jsonb_set pada event dan mengembalikan event utuh: session_id tidak hilang', () => {
    const hook = ambilFungsi(stripSqlComments(baca('202610080001_rbac_tahap0_keamanan.sql')), 'set_user_role_claim');
    expect(hook).toMatch(/event := pg_catalog\.jsonb_set\(\s*event,/);
    expect(hook).toMatch(/RETURN event;/);
    expect(hook).not.toMatch(/jsonb_build_object|'\{claims\}'/);
  });
});

describe('Sesi staf: daftarkan_sesi', () => {
  const f = ambilFungsi(sql, 'daftarkan_sesi');

  it('menolak non-staf (FORBIDDEN, 42501) dan klaim kosong (SESI_TANPA_KLAIM) SEBELUM menulis', () => {
    expect(f).toMatch(/v_uid IS NULL OR v_peran IS NULL OR v_peran NOT IN \('admin', 'petugas', 'front_office'\)/);
    expect(f).toMatch(/RAISE EXCEPTION 'FORBIDDEN:[^']*'\s+USING ERRCODE = '42501'/);
    expect(f).toMatch(/v_sid := public\.sesi_klaim_id\(\);\s+IF v_sid IS NULL THEN\s+RAISE EXCEPTION 'SESI_TANPA_KLAIM:/);
    expect(f.search(/FORBIDDEN/)).toBeLessThan(f.search(/SESI_TANPA_KLAIM/));
    expect(f.search(/SESI_TANPA_KLAIM/)).toBeLessThan(f.search(/INSERT INTO/));
  });

  it('peran dibaca dari get_my_role() (NULL untuk akun nonaktif)', () => {
    expect(f).toMatch(/v_peran text := public\.get_my_role\(\)/);
  });

  it('upsert baris pemanggil: MENIMPA session_id, dibuat_at, last_seen, aktivitas_at (sesi lama otomatis digantikan)', () => {
    const upsert = rapikan(f.match(/INSERT INTO[\s\S]*?aktivitas_at = EXCLUDED\.aktivitas_at;/)![0]);
    expect(upsert).toContain('ON CONFLICT (user_id) DO UPDATE');
    for (const k of ['session_id', 'dibuat_at', 'last_seen', 'aktivitas_at']) {
      expect(upsert).toContain(`${k} = EXCLUDED.${k}`);
    }
    // hanya untuk pemanggil sendiri (user_id dari auth.uid(), bukan parameter)
    expect(f).toMatch(/VALUES \(v_uid, v_sid,/);
    expect(f).not.toMatch(/p_user|p_uid/);
  });

  it('mengembalikan jsonb {ok, idle_menit}', () => {
    expect(rapikan(f)).toMatch(/RETURN pg_catalog\.jsonb_build_object\('ok', true, 'idle_menit', public\.sesi_idle_menit\(\)\);/);
  });
});

describe('Sesi staf: sesi_status / sesi_valid', () => {
  const f = ambilFungsi(sql, 'sesi_status');

  it('urutan cabang SQL = urutan simulator (bukan_staf, flag, klaim kosong, digantikan, idle, ok)', () => {
    const urutan = [...f.matchAll(/RETURN '(\w+)';/g)].map((m) => m[1]);
    expect(urutan).toEqual(['bukan_staf', 'tidak_terdaftar', 'transisi', 'tidak_terdaftar', 'digantikan', 'idle', 'ok']);
  });

  it('non-staf (uid NULL, tanpa peran, atau peran lain) -> bukan_staf', () => {
    expect(f).toMatch(/IF v_uid IS NULL OR v_peran IS NULL OR v_peran NOT IN \('admin', 'petugas', 'front_office'\) THEN\s+RETURN 'bukan_staf';/);
  });

  it('membandingkan klaim dengan session_id baris dan memeriksa idle pada last_seen DAN aktivitas_at', () => {
    expect(f).toMatch(/IF v_sid <> v_baris\.session_id THEN\s+RETURN 'digantikan';/);
    expect(rapikan(f)).toContain('v_baris.last_seen <= pg_catalog.now() - v_idle OR v_baris.aktivitas_at <= pg_catalog.now() - v_idle');
    expect(f).toMatch(/make_interval\(mins => public\.sesi_idle_menit\(\)\)/);
  });

  it('staf tanpa baris: flag aktif -> tidak_terdaftar, flag nonaktif -> transisi', () => {
    expect(rapikan(f)).toMatch(/IF NOT FOUND THEN IF public\.sesi_tunggal_aktif\(\) THEN RETURN 'tidak_terdaftar'; END IF; RETURN 'transisi'; END IF;/);
  });

  it('hanya membaca (STABLE), hanya baris pemanggil (user_id = auth.uid())', () => {
    expect(f).toMatch(/STABLE/);
    expect(f).toMatch(/WHERE ss\.user_id = v_uid/);
    expect(f).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
  });

  it("sesi_valid() = sesi_status() IN ('bukan_staf', 'transisi', 'ok'), STABLE", () => {
    const v = ambilFungsi(sql, 'sesi_valid');
    expect(rapikan(v)).toContain("SELECT public.sesi_status() IN ('bukan_staf', 'transisi', 'ok')");
    expect(v).toMatch(/STABLE/);
    expect(v).toMatch(/RETURNS boolean/);
  });

  describe('matriks keputusan (simulator)', () => {
    const baris = (o: Partial<Baris> = {}): Baris => ({ ...dasar.baris!, ...o });
    const kasus: Array<[string, Partial<Masukan>, StatusSesi, boolean]> = [
      ['pengunjung (anon) tidak terkena', { peran: null }, 'bukan_staf', true],
      ['peran lain (bukan staf) tidak terkena', { peran: 'pengunjung' }, 'bukan_staf', true],
      ['service_role / tanpa uid', { uid: null, peran: null, klaim: null, baris: null }, 'bukan_staf', true],
      ['staf nonaktif (get_my_role NULL) tidak terkena (ditolak guard peran lain)', { peran: null, baris: null, flagAktif: true }, 'bukan_staf', true],
      ['staf tanpa baris, flag false (transisi)', { baris: null, flagAktif: false }, 'transisi', true],
      ['staf tanpa baris, flag true (cutover)', { baris: null, flagAktif: true }, 'tidak_terdaftar', false],
      ['staf berbaris, sesi sama, segar', {}, 'ok', true],
      ['staf berbaris, sesi sama, flag true, segar', { flagAktif: true }, 'ok', true],
      ['sesi digantikan (login lain), flag false', { klaim: SID_B }, 'digantikan', false],
      ['sesi digantikan (login lain), flag true', { klaim: SID_B, flagAktif: true }, 'digantikan', false],
      ['klaim kosong padahal berbaris', { klaim: null }, 'tidak_terdaftar', false],
      ['idle: heartbeat berhenti 3 jam', { baris: baris({ lastSeen: NOW - 3 * 3_600_000 }) }, 'idle', false],
      ['idle: heartbeat jalan tetapi tanpa aktivitas 3 jam', { baris: baris({ aktivitasAt: NOW - 3 * 3_600_000 }) }, 'idle', false],
      ['tepat di batas idle (<=) tidak sah', { baris: baris({ lastSeen: NOW - 120 * 60_000 }) }, 'idle', false],
      ['semenit sebelum batas idle masih sah', { baris: baris({ lastSeen: NOW - 119 * 60_000, aktivitasAt: NOW - 119 * 60_000 }) }, 'ok', true],
      ['idle diperpendek admin (30 menit), 45 menit lalu', { idleMenit: 30, baris: baris({ lastSeen: NOW - 45 * 60_000 }) }, 'idle', false],
      ['idle ditegakkan juga saat flag false (baris = bukti klien terdaftar)', { flagAktif: false, baris: baris({ lastSeen: NOW - 5 * 3_600_000 }) }, 'idle', false],
    ];
    it.each(kasus)('%s', (_nama, ubah, status, valid) => {
      const m = { ...dasar, ...ubah };
      expect(sesiStatus(m)).toBe(status);
      expect(sesiValid(m)).toBe(valid);
    });

    it('prioritas: digantikan mengalahkan idle', () => {
      expect(sesiStatus({ ...dasar, klaim: SID_B, baris: baris({ lastSeen: 0, aktivitasAt: 0 }) })).toBe('digantikan');
    });

    it('login baru menimpa sesi lama: sesi A sah -> daftar B -> A digantikan, B sah', () => {
      const a = { ...dasar };
      expect(sesiValid(a)).toBe(true);
      const barisBaru: Baris = { sessionId: SID_B, lastSeen: NOW, aktivitasAt: NOW };
      expect(sesiValid({ ...a, baris: barisBaru })).toBe(false); // perangkat A (klaim A) setelah B mendaftar
      expect(sesiValid({ ...a, klaim: SID_B, baris: barisBaru })).toBe(true); // perangkat B
    });
  });

  describe('pembacaan pengaturan', () => {
    it('sesi_idle_menit: angka 5..1440, selain itu 120 (SQL dan simulator sama)', () => {
      const idle = ambilFungsi(sql, 'sesi_idle_menit');
      expect(idle).toMatch(/\^\[0-9\]\{1,4\}\$/);
      expect(idle).toMatch(/n BETWEEN 5 AND 1440/);
      expect(idle).toMatch(/RETURN 120;/);
      expect(idle).toMatch(/s\.key = 'sesi_idle_menit'/);
      expect([null, '', 'abc', '4', '1441', '-5', '12.5'].map(parseIdle)).toEqual([120, 120, 120, 120, 120, 120, 120]);
      expect(['5', ' 90 ', '120', '1440'].map(parseIdle)).toEqual([5, 90, 120, 1440]);
    });

    it('sesi_tunggal_aktif: kosong/hilang false; nilai false eksplisit false; nilai lain true (gagal tertutup)', () => {
      const fl = ambilFungsi(sql, 'sesi_tunggal_aktif');
      expect(fl).toMatch(/s\.key = 'sesi_tunggal_aktif'/);
      expect(fl).toMatch(/IF v IS NULL OR v = '' THEN\s+RETURN false;/);
      expect(fl).toMatch(/RETURN v NOT IN \('false', '0', 'off', 'no', 'tidak', 'nonaktif'\);/);
      expect([null, '', '  ', 'false', 'FALSE', ' 0 ', 'off', 'no', 'tidak', 'nonaktif'].map(parseFlag)).toEqual(Array(10).fill(false));
      expect(['true', 'TRUE', '1', 'ya', 'aktif', 'typo'].map(parseFlag)).toEqual(Array(6).fill(true));
    });
  });
});

describe('Sesi staf: ping_sesi', () => {
  const f = ambilFungsi(sql, 'ping_sesi');

  it('sesi tidak sah dikembalikan SEBELUM pembaruan mana pun (tidak memperbarui last_seen)', () => {
    const iInvalid = f.search(/IF v_status NOT IN \('bukan_staf', 'transisi', 'ok'\) THEN\s+RETURN/);
    const iUpdate = f.search(/UPDATE public\.sesi_staf/);
    expect(iInvalid).toBeGreaterThanOrEqual(0);
    expect(iUpdate).toBeGreaterThan(iInvalid);
    expect([...f.matchAll(/\bUPDATE\b/g)]).toHaveLength(1);
    expect(f).toMatch(/'valid', false, 'status', v_status, 'alasan', v_status/);
  });

  it("pembaruan hanya bila status 'ok' (bukan untuk transisi/bukan_staf), hanya baris dan session_id pemanggil", () => {
    expect(f).toMatch(/IF v_status = 'ok' THEN\s+UPDATE public\.sesi_staf AS ss/);
    expect(f).toMatch(/WHERE ss\.user_id = v_uid AND ss\.session_id = public\.sesi_klaim_id\(\)/);
    expect(f).toMatch(/RETURNING ss\.dibuat_at INTO v_dibuat;/);
  });

  it('p_aktif memperbarui aktivitas_at hanya bila true; last_seen selalu; NULL dianggap true', () => {
    expect(rapikan(f)).toContain('last_seen = pg_catalog.now(), aktivitas_at = CASE WHEN COALESCE(p_aktif, true) THEN pg_catalog.now() ELSE ss.aktivitas_at END');
  });

  it("tertimpa di antara status dan pembaruan (NOT FOUND) -> {valid:false, alasan:'digantikan'}", () => {
    expect(rapikan(f)).toMatch(/IF NOT FOUND THEN RETURN pg_catalog\.jsonb_build_object\( 'valid', false, 'status', 'digantikan'/);
  });

  it('bendera tutup memakai jam_tutup_layanan() (bukan hardcode) dan zona WIB; hasil valid memuat tutup dan idle_menit', () => {
    expect(f).toMatch(/public\.jam_tutup_layanan\(\)/);
    expect(f).toMatch(/AT TIME ZONE 'Asia\/Jakarta'/);
    expect(f).toMatch(/interval '1 day'/);
    expect(rapikan(f)).toContain("'valid', true, 'status', v_status, 'tutup', v_tutup, 'idle_menit', v_idle");
    expect(sql).not.toMatch(/16:00|time\s+'1\d:/);
  });

  it('tidak membaca antrean_dibuka() dan tidak memakai UTC/CURRENT_DATE mentah (semua WIB lewat AT TIME ZONE)', () => {
    expect(sql).not.toMatch(/antrean_dibuka/);
    expect(sql).not.toMatch(/CURRENT_DATE|current_date|toISOString/);
  });

  describe('bendera tutup (simulator, jam tutup 16:00 WIB = 960 menit)', () => {
    const J = 16 * 60;
    it.each([
      ['login 08:00, sekarang 10:00 -> belum tutup', '2026-10-14T08:00:00', '2026-10-14T10:00:00', false],
      ['login 08:00, sekarang 15:59 -> belum tutup', '2026-10-14T08:00:00', '2026-10-14T15:59:00', false],
      ['login 08:00, sekarang 16:00 -> tutup', '2026-10-14T08:00:00', '2026-10-14T16:00:00', true],
      ['login 08:00, sekarang 21:00 -> tutup', '2026-10-14T08:00:00', '2026-10-14T21:00:00', true],
      ['login 17:00 (lembur), sekarang 18:00 -> TIDAK langsung tutup', '2026-10-14T17:00:00', '2026-10-14T18:00:00', false],
      ['login 17:00, esok 10:00 -> belum tutup (batas terakhir kemarin 16:00)', '2026-10-14T17:00:00', '2026-10-15T10:00:00', false],
      ['login 17:00, esok 16:00 -> tutup', '2026-10-14T17:00:00', '2026-10-15T16:00:00', true],
      ['login kemarin 08:00, hari ini 07:00 -> tutup (melewati 16:00 kemarin)', '2026-10-13T08:00:00', '2026-10-14T07:00:00', true],
      ['login 00:30 WIB (hari WIB baru), sekarang 01:00 -> belum tutup', '2026-10-14T00:30:00', '2026-10-14T01:00:00', false],
    ])('%s', (_n, dibuat, sekarang, hasil) => {
      expect(tutup(wib(dibuat), wib(sekarang), J)).toBe(hasil);
    });
  });
});

describe('Sesi staf: akhiri_sesi', () => {
  const f = ambilFungsi(sql, 'akhiri_sesi');
  it('menghapus HANYA baris milik sesi pemanggil (user_id dan session_id); logout sesi lama tidak menghapus sesi baru', () => {
    expect(f).toMatch(/DELETE FROM public\.sesi_staf AS ss WHERE ss\.user_id = v_uid AND ss\.session_id = v_sid;/);
    expect(f).toMatch(/IF v_uid IS NOT NULL AND v_sid IS NOT NULL THEN/);
    expect([...f.matchAll(/\bDELETE\b/g)]).toHaveLength(1);
    expect(rapikan(f)).toContain("'ok', true, 'dihapus', v_n > 0");
  });
});

describe('Sesi staf: pengaturan site_settings', () => {
  const ins = sql.match(/INSERT INTO public\.site_settings[\s\S]*?;/)![0];

  it('dua kunci dengan default 120 dan false, ON CONFLICT (key) DO NOTHING (tidak menimpa nilai yang ada)', () => {
    expect(rapikan(ins)).toMatch(/\(key, value, keterangan\)/);
    expect(ins).toMatch(/\('sesi_idle_menit', '120',/);
    expect(ins).toMatch(/\('sesi_tunggal_aktif', 'false',/);
    expect(rapikan(ins)).toMatch(/ON CONFLICT \(key\) DO NOTHING;$/);
    expect(ins).not.toMatch(/DO UPDATE/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.site_settings/i);
  });

  it('policy site_settings yang ada: baca publik, tulis admin; tidak diubah migrasi ini (fungsi definer tidak terhalang RLS)', () => {
    const awal = stripSqlComments(baca('202607140004_security_and_automation.sql'));
    expect(awal).toMatch(/CREATE POLICY "settings_public_read" ON public\.site_settings FOR SELECT USING \(true\)/);
    expect(awal).toMatch(/CREATE POLICY "settings_admin_all" ON public\.site_settings FOR ALL TO authenticated\s+USING \(public\.get_my_role\(\) = 'admin'\)/);
    expect(sql).not.toMatch(/POLICY/i);
  });

  it('guard jam_tutup_layanan hanya menjaga kunci jam_tutup_layanan (tidak menghalangi dua kunci baru)', () => {
    const guard = stripSqlComments(baca('202610090005_perbaikan_review.sql')).match(/FUNCTION public\.guard_jam_tutup_layanan[\s\S]*?\$\$;/)![0];
    expect(guard).toMatch(/NEW\.key = 'jam_tutup_layanan'/);
  });
});

describe('Sesi staf: sumber jam tutup yang dirujuk memang ada', () => {
  it('public.jam_tutup_layanan() didefinisikan di 202610090001 (sebelum berkas ini) dari site_settings.jam_tutup_layanan', () => {
    const sebelum = listMigrationFiles().filter((n) => n < BERKAS);
    const definisi = sebelum.filter((n) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.jam_tutup_layanan\b/i.test(stripSqlComments(baca(n))));
    expect(definisi).toEqual(['202610090001_rbac_tahap1.sql']);
    const f = ambilFungsi(stripSqlComments(baca(definisi[0])), 'jam_tutup_layanan');
    expect(f).toMatch(/s\.key = 'jam_tutup_layanan'/);
    expect(f).toMatch(/RETURNS time/);
  });

  it('get_my_role() didefinisikan terakhir di 202607290004 (NULL untuk petugas nonaktif)', () => {
    const sebelum = listMigrationFiles().filter((n) => n < BERKAS);
    const definisi = sebelum.filter((n) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_my_role\b/i.test(stripSqlComments(baca(n))));
    expect(definisi.at(-1)).toBe('202607290004_petugas_aktif.sql');
  });
});

describe('Sesi staf: rollback', () => {
  it('penjaga di awal: menolak bila fungsi/policy lain masih memanggil fungsi sesi, SEBELUM DROP apa pun', () => {
    const doBlok = rollback.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/sesi_valid\|sesi_status\|daftarkan_sesi\|ping_sesi\|akhiri_sesi/);
    expect(doBlok).toMatch(/pg_policies/);
    expect([...doBlok.matchAll(/RAISE EXCEPTION/g)]).toHaveLength(2);
    expect(rollback.search(/DO \$\$/)).toBeGreaterThanOrEqual(0);
    expect(rollback.search(/\bDROP\b/)).toBeGreaterThan(rollback.search(/DO \$\$/));
    expect(rollback.search(/\bDELETE\b/)).toBeGreaterThan(rollback.search(/DO \$\$/));
  });

  it('penjaga mengecualikan kedelapan fungsi milik migrasi ini', () => {
    const doBlok = rollback.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    for (const f of SEMUA_FUNGSI) expect(doBlok).toContain(`'${f}'`);
  });

  it('membalik SEMUANYA: 8 fungsi, tabel, dan dua pengaturan; idempoten (IF EXISTS)', () => {
    for (const f of SEMUA_FUNGSI) {
      const arg = f === 'ping_sesi' ? 'boolean' : '';
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${f}(${arg});`);
    }
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.sesi_staf;/);
    expect(rollback).toMatch(/DELETE FROM public\.site_settings WHERE key IN \('sesi_idle_menit', 'sesi_tunggal_aktif'\);/);
    expect([...rollback.matchAll(/DROP FUNCTION IF EXISTS/g)]).toHaveLength(8);
    expect(rollback).not.toMatch(/DROP FUNCTION(?! IF EXISTS)|DROP TABLE(?! IF EXISTS)|CASCADE/i);
  });

  it('fungsi DROP urut dari yang bergantung ke yang dipakai; tabel di-DROP setelah semua fungsi', () => {
    const pos = (n: string) => rollback.indexOf(`public.${n}(`);
    expect(pos('akhiri_sesi')).toBeLessThan(pos('sesi_valid'));
    expect(pos('ping_sesi')).toBeLessThan(pos('sesi_status'));
    expect(pos('daftarkan_sesi')).toBeLessThan(pos('sesi_klaim_id'));
    expect(pos('sesi_valid')).toBeLessThan(pos('sesi_status'));
    expect(pos('sesi_status')).toBeLessThan(pos('sesi_tunggal_aktif'));
    expect(pos('sesi_klaim_id')).toBeLessThan(rollback.indexOf('DROP TABLE'));
  });

  it('hanya menyentuh objek milik migrasi ini (tidak ada objek lain di DROP/DELETE)', () => {
    for (const m of rollback.matchAll(/DROP FUNCTION IF EXISTS public\.(\w+)/g)) expect(SEMUA_FUNGSI).toContain(m[1]);
    for (const m of rollback.matchAll(/DELETE\s+FROM\s+([\w.]+)/g)) expect(m[1]).toBe('public.site_settings');
    expect(rollback).not.toMatch(/\bUPDATE\b|\bTRUNCATE\b|\bINSERT\b|ALTER\s/i);
  });
});

describe('Sesi staf: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di docs/MIGRATIONS.md dan docs/analysis/DB-CHANGES.md dengan status penerapan dan peringatan flag', () => {
    const migrations = bacaDocs('MIGRATIONS.md');
    expect(migrations).toContain('202610140001_sesi_staf');
    expect(migrations).toMatch(/202610140001_sesi_staf[\s\S]{0,3000}sesi_tunggal_aktif[\s\S]{0,200}false/);
    const dbChanges = bacaDocs('analysis', 'DB-CHANGES.md');
    expect(dbChanges).toContain('202610140001_sesi_staf');
    expect(dbChanges).toMatch(/202610140001_sesi_staf[\s\S]{0,4000}BELUM DITERAPKAN/);
    expect(dbChanges).toMatch(/202610140001_sesi_staf[\s\S]{0,4000}sesi_tunggal_aktif/);
  });
});
