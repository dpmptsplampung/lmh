// Uji parser penanda migrasi (scripts/lib/migration-markers.mjs). Murni: tanpa database.
// Berkas ini ada di src/test/ agar ikut `npm test` (vitest.config.ts hanya meng-include src/** dan supabase/migrations/**).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analisisRiwayat,
  bersihkanSql,
  ekstrakPenanda,
  nilaiIsiFungsi,
  normalisasiBadan,
  normalisasiTipe,
  pecahPernyataan,
  tentukanStatus,
} from '../../scripts/lib/migration-markers.mjs';

/** Peristiwa yang terlihat (bukan implisit dari badan CREATE TABLE), dalam bentuk "aksi kunci". */
const ev = (sql: string) =>
  ekstrakPenanda(sql).peristiwa.filter((e) => !e.implisit).map((e) => `${e.aksi} ${e.kunci}`);

describe('bersihkanSql', () => {
  it('membuang komentar baris & blok serta menyamarkan isi string', () => {
    const { teks, literal } = bersihkanSql("SELECT 'CREATE TABLE x' -- CREATE TABLE y\n/* CREATE TABLE z */ FROM t");
    expect(teks).not.toMatch(/CREATE TABLE/);
    expect(literal).toEqual(['CREATE TABLE x']);
  });

  it('menyamarkan badan fungsi tetapi meng-inline badan blok DO', () => {
    const sql = `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ CREATE TABLE di_badan(x int) $$;
DO $do$ BEGIN CREATE TABLE di_do(x int); END $do$;`;
    const { teks, badan } = bersihkanSql(sql);
    expect(teks).not.toContain('di_badan');
    expect(teks).toContain('di_do');
    expect(badan).toEqual([' CREATE TABLE di_badan(x int) ']);
  });

  it('apostrof di dalam komentar tidak merusak pemindaian string', () => {
    const { teks } = bersihkanSql("-- don't\nCREATE TABLE public.a (x int);");
    expect(teks).toContain('CREATE TABLE public.a');
  });
});

describe('pecahPernyataan', () => {
  it('memecah pada ; tingkat atas, mengabaikan ; di string/dollar-quote, komentar menempel ke pernyataan berikutnya', () => {
    const sql = `-- judul
BEGIN;
CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;
INSERT INTO t VALUES ('a;b');
-- komentar yatim
`;
    expect(pecahPernyataan(sql)).toEqual([
      '-- judul\nBEGIN',
      'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$',
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });

  it('berkas yang hanya berisi komentar menghasilkan daftar kosong', () => {
    expect(pecahPernyataan('-- no-op\n-- lagi\n')).toEqual([]);
  });
});

describe('ekstrakPenanda: pembuatan objek', () => {
  it('CREATE TABLE [IF NOT EXISTS] dengan atau tanpa skema; TEMP diabaikan', () => {
    expect(ev('CREATE TABLE IF NOT EXISTS public.a (id int);')).toEqual(['buat tabel:public.a']);
    expect(ev('CREATE TABLE b (id int);')).toEqual(['buat tabel:public.b']);
    expect(ev('CREATE TEMP TABLE c (id int);')).toEqual([]);
  });

  it('ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] (beberapa kolom dalam satu pernyataan)', () => {
    const sql = `ALTER TABLE public.t
  ADD COLUMN IF NOT EXISTS a text,
  ADD COLUMN b integer NOT NULL DEFAULT 0;`;
    expect(ev(sql)).toEqual(['buat kolom:public.t.a', 'buat kolom:public.t.b']);
  });

  it('CREATE [OR REPLACE] FUNCTION: kunci memuat jumlah argumen (overload) dan mengabaikan OUT', () => {
    expect(ev('CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;')).toEqual(['buat fungsi:public.f/0']);
    expect(ev(`CREATE OR REPLACE FUNCTION public.g(a uuid, b text DEFAULT 'x,y', c numeric(10,2) DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`)).toEqual(['buat fungsi:public.g/3']);
    expect(ev('CREATE FUNCTION public.h(a int, OUT b int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;')).toEqual(['buat fungsi:public.h/1']);
  });

  it('CREATE [UNIQUE] INDEX [IF NOT EXISTS] bernama; indeks tanpa nama diabaikan', () => {
    expect(ev('CREATE INDEX IF NOT EXISTS idx_a ON public.t(a);')).toEqual(['buat indeks:public.idx_a']);
    expect(ev('CREATE UNIQUE INDEX uq_b ON public.t (b);')).toEqual(['buat indeks:public.uq_b']);
    expect(ev('CREATE INDEX ON public.t (c);')).toEqual([]);
  });

  it('CREATE POLICY dengan nama berkutip maupun tidak, termasuk tabel di skema lain', () => {
    expect(ev('CREATE POLICY "Nama Policy" ON public.t FOR SELECT USING (true);')).toEqual(['buat policy:public.t:Nama Policy']);
    expect(ev('CREATE POLICY p1 ON public.t FOR ALL USING (true);')).toEqual(['buat policy:public.t:p1']);
    expect(ev('CREATE POLICY "x" ON storage.objects FOR SELECT USING (true);')).toEqual(['buat policy:storage.objects:x']);
  });

  it('CREATE [OR REPLACE] VIEW dan MATERIALIZED VIEW; view TEMP diabaikan', () => {
    expect(ev('CREATE OR REPLACE VIEW public.v AS SELECT 1;')).toEqual(['buat view:public.v']);
    expect(ev('CREATE VIEW public.v2 WITH (security_invoker = true) AS SELECT 1;')).toEqual(['buat view:public.v2']);
    expect(ev('CREATE MATERIALIZED VIEW public.mv AS SELECT 1;')).toEqual(['buat view:public.mv']);
    expect(ev('CREATE TEMP VIEW tv AS SELECT 1;')).toEqual([]);
  });

  it('CREATE TRIGGER dengan tabel setelah ON, termasuk UPDATE OF kolom', () => {
    const sql = `CREATE TRIGGER trg_a
  AFTER INSERT OR UPDATE OF status, nama ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.f();`;
    expect(ev(sql)).toEqual(['buat trigger:public.visit:trg_a']);
  });

  it("cron.schedule('nama', ...) dikenali; bentuk 2-argumen (ekspresi cron saja) diabaikan; unschedule bernama = hapus", () => {
    expect(ev("SELECT cron.schedule('notif_h0', '0 0 * * *', $$SELECT 1$$);")).toEqual(['buat cron:notif_h0']);
    expect(ev("SELECT cron.schedule('0 0 * * *', $$SELECT 1$$);")).toEqual([]);
    expect(ev("SELECT cron.unschedule('lama');")).toEqual(['hapus cron:lama']);
  });

  it('ADD CONSTRAINT, ALTER COLUMN TYPE, ALTER PUBLICATION ADD TABLE, CREATE EXTENSION, INSERT storage.buckets', () => {
    const sql = `
ALTER TABLE public.t ADD CONSTRAINT t_a_check CHECK (a > 0);
ALTER TABLE public.f ALTER COLUMN emb TYPE extensions.vector(3072);
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sesi;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
INSERT INTO storage.buckets (id, name, public) VALUES ('absensi-foto', 'absensi-foto', false);`;
    expect(ev(sql)).toEqual([
      'buat constraint:public.t:t_a_check',
      'buat tipe:public.f.emb',
      'buat publikasi:supabase_realtime:public.chat_sesi',
      'buat ekstensi:pg_trgm',
      'buat bucket:absensi-foto',
    ]);
    const tipe = ekstrakPenanda(sql).peristiwa.find((e) => e.jenis === 'tipe_kolom');
    expect(tipe?.tipe).toBe('vector(3072)');
  });

  it('DDL di dalam blok DO ikut terdeteksi (CREATE TABLE & ALTER PUBLICATION), tetapi di badan fungsi tidak', () => {
    const sql = `
DO $$ BEGIN
  IF to_regclass('public.led') IS NULL THEN CREATE TABLE public.led (id int); END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tiket;
END $$;
CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'CREATE TABLE public.dinamis(x int)'; CREATE TABLE public.di_fungsi(x int); END $$;`;
    expect(ev(sql)).toEqual([
      'buat tabel:public.led',
      'buat publikasi:supabase_realtime:public.tiket',
      'buat fungsi:public.f/0',
    ]);
  });

  it('kata kunci di komentar dan string tidak dihitung', () => {
    const sql = `-- CREATE TABLE public.komentar (x int);
COMMENT ON TABLE public.a IS 'CREATE POLICY p ON public.a';
RAISE NOTICE 'DROP TABLE public.z';`;
    expect(ev(sql)).toEqual([]);
  });

  it('badan CREATE TABLE menghasilkan kolom/tipe/constraint IMPLISIT (hanya untuk lini masa)', () => {
    const sql = `CREATE TABLE public.t (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emb extensions.vector(768),
  harga numeric(10, 2) NOT NULL,
  CONSTRAINT t_ck CHECK (harga >= 0),
  UNIQUE (id)
);`;
    const semua = ekstrakPenanda(sql).peristiwa;
    expect(semua.filter((e) => e.implisit).map((e) => e.kunci)).toEqual(expect.arrayContaining([
      'kolom:public.t.id', 'kolom:public.t.emb', 'kolom:public.t.harga', 'constraint:public.t:t_ck', 'tipe:public.t.emb',
    ]));
    expect(semua.find((e) => e.kunci === 'tipe:public.t.emb')?.tipe).toBe('vector(768)');
    expect(semua.find((e) => e.kunci === 'tipe:public.t.harga')?.tipe).toBe('numeric(10,2)');
    expect(ev(sql)).toEqual(['buat tabel:public.t']);
  });
});

describe('ekstrakPenanda: penghapusan objek', () => {
  it('DROP TABLE/COLUMN/CONSTRAINT/FUNCTION/INDEX/POLICY/VIEW/TRIGGER/PUBLICATION', () => {
    const sql = `
DROP TABLE IF EXISTS public.a, public.b;
ALTER TABLE public.t DROP COLUMN IF EXISTS c;
ALTER TABLE public.t DROP CONSTRAINT IF EXISTS t_ck;
DROP FUNCTION IF EXISTS public.f(uuid, text, uuid);
DROP INDEX IF EXISTS public.idx_x;
DROP POLICY IF EXISTS p1 ON public.t;
DROP VIEW IF EXISTS public.v;
DROP TRIGGER IF EXISTS trg ON public.t;
ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_sesi;`;
    expect(ev(sql)).toEqual([
      'hapus tabel:public.a', 'hapus tabel:public.b',
      'hapus kolom:public.t.c',
      'hapus constraint:public.t:t_ck',
      'hapus fungsi:public.f/3',
      'hapus indeks:public.idx_x',
      'hapus policy:public.t:p1',
      'hapus view:public.v',
      'hapus trigger:public.t:trg',
      'hapus publikasi:supabase_realtime:public.chat_sesi',
    ]);
  });

  it('DROP FUNCTION tanpa daftar argumen menghasilkan peringatan, bukan tebakan', () => {
    const r = ekstrakPenanda('DROP FUNCTION public.f;');
    expect(r.peristiwa).toEqual([]);
    expect(r.peringatan.join(' ')).toMatch(/tanpa daftar argumen/);
  });

  it('RENAME tidak dimodelkan dan memberi peringatan', () => {
    expect(ekstrakPenanda('ALTER TABLE public.a RENAME TO b;').peringatan.join(' ')).toMatch(/RENAME/);
  });
});

describe('normalisasi', () => {
  it('normalisasiTipe menyeragamkan alias dan awalan skema', () => {
    expect(normalisasiTipe('extensions.vector(3072)')).toBe('vector(3072)');
    expect(normalisasiTipe('timestamptz')).toBe('timestamp with time zone');
    expect(normalisasiTipe('TIMESTAMP WITH TIME ZONE')).toBe('timestamp with time zone');
    expect(normalisasiTipe('timestamp')).toBe('timestamp without time zone');
    expect(normalisasiTipe('time')).toBe('time without time zone');
    expect(normalisasiTipe('TIME WITH TIME ZONE')).toBe('time with time zone');
    expect(normalisasiTipe('timetz')).toBe('time with time zone');
    expect(normalisasiTipe('varchar( 255 )')).toBe('character varying(255)');
    expect(normalisasiTipe('int')).toBe('integer');
    expect(normalisasiTipe('numeric(10, 2)')).toBe('numeric(10,2)');
    expect(normalisasiTipe('text[]')).toBe('text[]');
  });

  it('normalisasiBadan membuang komentar, CR, dan meratakan spasi tetapi mempertahankan isi string', () => {
    const a = normalisasiBadan("\r\nBEGIN\r\n  -- catatan\n  SELECT 'a -- b';  /* blok */\nEND\n");
    expect(a).toBe("BEGIN SELECT 'a -- b'; END");
  });
});

describe('analisisRiwayat', () => {
  const ana = (...sqls: string[]) =>
    analisisRiwayat(sqls.map((sql, i) => ({ versi: `2026000000${String(i + 1).padStart(2, '0')}`, nama: `m${i + 1}`, sql })));
  const cari = (h: ReturnType<typeof ana>[number], kunci: string) => h.penanda.find((p) => p.kunci === kunci);

  it('objek yang hanya dibuat satu migrasi = kuat', () => {
    const [m1] = ana('CREATE TABLE public.a (id int);');
    expect(cari(m1, 'tabel:public.a')).toMatchObject({ status: 'aktif', kekuatan: 'kuat', dibagiDengan: [] });
  });

  it('objek yang juga didefinisikan ulang migrasi lain = lemah (dua arah)', () => {
    const [m1, m2] = ana(
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
      'CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;',
    );
    expect(cari(m1, 'fungsi:public.f/0')).toMatchObject({ status: 'aktif', kekuatan: 'lemah', dibagiDengan: ['202600000002'] });
    expect(cari(m2, 'fungsi:public.f/0')).toMatchObject({ status: 'aktif', kekuatan: 'lemah', dibagiDengan: ['202600000001'] });
  });

  it('objek di-DROP migrasi lebih baru = digantikan (dengan versi penggantinya); DROP-nya menjadi pemeriksaan negatif', () => {
    const [m1, m2] = ana('CREATE TABLE public.a (id int); CREATE VIEW public.v AS SELECT 1;', 'DROP VIEW public.v;');
    expect(cari(m1, 'view:public.v')).toMatchObject({ status: 'digantikan', digantikanOleh: '202600000002' });
    expect(cari(m1, 'tabel:public.a')?.status).toBe('aktif');
    expect(cari(m2, 'view:public.v')).toMatchObject({ aksi: 'hapus', status: 'aktif' });
  });

  it('DROP lalu dibuat ulang oleh migrasi lebih baru => DROP-nya digantikan, pembuatan terakhir tetap aktif', () => {
    const [m1, m2, m3] = ana('CREATE VIEW public.v AS SELECT 1;', 'DROP VIEW public.v;', 'CREATE VIEW public.v AS SELECT 2;');
    expect(cari(m1, 'view:public.v')?.status).toBe('aktif');
    expect(cari(m2, 'view:public.v')).toMatchObject({ aksi: 'hapus', status: 'digantikan', digantikanOleh: '202600000003' });
    expect(cari(m3, 'view:public.v')).toMatchObject({ aksi: 'buat', status: 'aktif', kekuatan: 'lemah' });
  });

  it('dibuat lalu di-DROP dalam migrasi yang sama diabaikan; DROP lalu CREATE dalam satu migrasi = aktif', () => {
    const [m1] = ana('CREATE TABLE public.sementara (x int); DROP TABLE public.sementara;');
    expect(cari(m1, 'tabel:public.sementara')).toMatchObject({ aksi: 'hapus', status: 'digantikan' });
    const [m2] = ana('DROP POLICY IF EXISTS p ON public.t; CREATE POLICY p ON public.t FOR ALL USING (true);');
    expect(cari(m2, 'policy:public.t:p')).toMatchObject({ aksi: 'buat', status: 'aktif', kekuatan: 'kuat' });
  });

  it('overload dibedakan lewat jumlah argumen (catat_absensi 3 arg di-DROP lalu 4 arg dibuat)', () => {
    const [m1, m2] = ana(
      'CREATE FUNCTION public.catat_absensi(a uuid, b text, c uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT 1 $$;',
      `DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid);
       CREATE FUNCTION public.catat_absensi(a uuid, b text, c uuid DEFAULT NULL, d text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$ SELECT 2 $$;`,
    );
    expect(cari(m1, 'fungsi:public.catat_absensi/3')).toMatchObject({ status: 'digantikan', digantikanOleh: '202600000002' });
    expect(cari(m2, 'fungsi:public.catat_absensi/4')).toMatchObject({ status: 'aktif', kekuatan: 'kuat' });
  });

  it('constraint yang pernah di-DROP tanpa dibuat dulu (nama otomatis) dianggap lemah', () => {
    const [m1] = ana('ALTER TABLE public.t DROP CONSTRAINT IF EXISTS t_status_check; ALTER TABLE public.t ADD CONSTRAINT t_status_check CHECK (true);');
    expect(cari(m1, 'constraint:public.t:t_status_check')).toMatchObject({ status: 'aktif', kekuatan: 'lemah' });
  });

  it('tipe kolom yang diubah lagi oleh migrasi lebih baru = digantikan; kolom baru yang tipenya sama dengan awal = lemah', () => {
    const [m1, m2] = ana(
      'CREATE TABLE public.f (emb extensions.vector(768)); ALTER TABLE public.f ALTER COLUMN emb TYPE extensions.vector(1024);',
      'ALTER TABLE public.f ALTER COLUMN emb TYPE extensions.vector(3072);',
    );
    expect(cari(m1, 'tipe:public.f.emb')).toMatchObject({ status: 'digantikan', digantikanOleh: '202600000002' });
    expect(cari(m2, 'tipe:public.f.emb')).toMatchObject({ status: 'aktif', kekuatan: 'kuat', tipe: 'vector(3072)' });
  });

  it('objek turunan ikut digantikan bila tabel induknya di-DROP migrasi lebih baru', () => {
    const [m1] = ana(
      'CREATE TABLE public.t (id int); CREATE INDEX idx_t ON public.t(id); CREATE POLICY p ON public.t FOR ALL USING (true);',
      'DROP TABLE public.t;',
    );
    expect(cari(m1, 'indeks:public.idx_t')).toMatchObject({ status: 'digantikan' });
    expect(cari(m1, 'policy:public.t:p')).toMatchObject({ status: 'digantikan' });
  });

  it('kolom yang sudah ada di CREATE TABLE migrasi lain tidak boleh dianggap kuat saat ADD COLUMN IF NOT EXISTS', () => {
    const [, m2] = ana(
      'CREATE TABLE public.t (id int, a text);',
      'ALTER TABLE public.t ADD COLUMN IF NOT EXISTS a text;',
    );
    expect(cari(m2, 'kolom:public.t.a')).toMatchObject({ kekuatan: 'lemah', dibagiDengan: ['202600000001'] });
  });

  it('sidik jari isi fungsi disertakan pada penanda fungsi', () => {
    const [m1] = ana('CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ -- c\n SELECT   1 $$;');
    expect(cari(m1, 'fungsi:public.f/0')?.sidik).toBe('SELECT 1');
  });
});

describe('nilaiIsiFungsi', () => {
  const p = { sidik: 'B2', definisi: [{ versi: '1', sidik: 'B1' }, { versi: '2', sidik: 'B2' }, { versi: '3', sidik: 'B3' }] };
  it('identik hanya dengan migrasi ini => sama_unik', () => expect(nilaiIsiFungsi(p, '2', ['B2'])).toBe('sama_unik'));
  it('identik dengan migrasi lebih lama saja => lebih_lama (versi ini belum diterapkan)', () => expect(nilaiIsiFungsi(p, '2', ['B1'])).toBe('lebih_lama'));
  it('identik dengan migrasi lebih baru saja => lebih_baru (ditimpa)', () => expect(nilaiIsiFungsi(p, '2', ['B3'])).toBe('lebih_baru'));
  it('tidak identik dengan definisi mana pun => tidak_cocok', () => expect(nilaiIsiFungsi(p, '2', ['lain'])).toBe('tidak_cocok'));
  it('definisi lain berbadan sama => sama_ambigu', () => {
    const q = { sidik: 'B', definisi: [{ versi: '1', sidik: 'B' }, { versi: '2', sidik: 'B' }] };
    expect(nilaiIsiFungsi(q, '2', ['B'])).toBe('sama_ambigu');
  });
  it('tanpa sidik atau tanpa badan DB => tanpa_sidik', () => {
    expect(nilaiIsiFungsi({}, '1', ['x'])).toBe('tanpa_sidik');
    expect(nilaiIsiFungsi(p, '2', undefined)).toBe('tanpa_sidik');
  });
  it('membandingkan badan DB setelah normalisasi (spasi/komentar)', () => {
    expect(nilaiIsiFungsi(p, '2', ['\n  B2 -- komentar\n'])).toBe('sama_unik');
  });
});

describe('tentukanStatus', () => {
  const buat = (ada: boolean | null, kekuatan: 'kuat' | 'lemah' | null = 'kuat', status: 'aktif' | 'digantikan' = 'aktif') =>
    ({ aksi: 'buat' as const, status, kekuatan, ada });
  const hapus = (ada: boolean | null, status: 'aktif' | 'digantikan' = 'aktif') =>
    ({ aksi: 'hapus' as const, status, kekuatan: null, ada });

  it('terpasang: semua ada dan ada penanda kuat', () => {
    expect(tentukanStatus([buat(true), buat(true, 'lemah')]).status).toBe('terpasang');
  });
  it('sebagian: ada penanda kuat yang ada + ada yang hilang', () => {
    expect(tentukanStatus([buat(true), buat(false, 'lemah')]).status).toBe('sebagian');
  });
  it('tidak_ditemukan: ada yang hilang dan tidak ada penanda kuat yang ada', () => {
    expect(tentukanStatus([buat(false), buat(true, 'lemah')]).status).toBe('tidak_ditemukan');
    expect(tentukanStatus([buat(false)]).status).toBe('tidak_ditemukan');
  });
  it('tidak_dapat_ditentukan: semua penanda yang ada lemah', () => {
    expect(tentukanStatus([buat(true, 'lemah'), buat(true, 'lemah')]).status).toBe('tidak_dapat_ditentukan');
  });
  it('tidak_dapat_ditentukan: tanpa penanda aktif (kosong atau seluruhnya digantikan)', () => {
    expect(tentukanStatus([]).status).toBe('tidak_dapat_ditentukan');
    expect(tentukanStatus([buat(false, null, 'digantikan')]).status).toBe('tidak_dapat_ditentukan');
  });
  it('penanda digantikan tidak dihitung, walau hilang', () => {
    expect(tentukanStatus([buat(true), buat(false, null, 'digantikan')]).status).toBe('terpasang');
  });
  it('objek yang seharusnya di-DROP tetapi masih ada => bukan terpasang; yang sudah tidak ada bukan bukti', () => {
    expect(tentukanStatus([buat(true), hapus(true)]).status).toBe('sebagian');
    expect(tentukanStatus([hapus(true)]).status).toBe('tidak_ditemukan');
    expect(tentukanStatus([hapus(false)]).status).toBe('tidak_dapat_ditentukan');
    expect(tentukanStatus([buat(true), hapus(false)]).status).toBe('terpasang');
  });
  it('penanda yang tidak dapat diperiksa mencegah status terpasang', () => {
    expect(tentukanStatus([buat(true), buat(null)]).status).toBe('tidak_dapat_ditentukan');
  });
});

// Migrasi bersifat immutable (T11), jadi fakta berikut stabil. Menguji parser terhadap berkas SQL nyata di repo.
describe('korpus migrasi nyata', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');
  const berkas = readdirSync(dir)
    .filter((f) => /^\d{12}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ versi: f.slice(0, 12), nama: f.slice(13, -4), sql: readFileSync(join(dir, f), 'utf8') }));
  const hasil = analisisRiwayat(berkas);
  const dari = (versi: string) => {
    const h = hasil.find((x) => x.versi === versi);
    if (!h) throw new Error(`migrasi ${versi} tidak ada`);
    return h;
  };

  it('seluruh berkas terurai tanpa peringatan parser', () => {
    expect(berkas.length).toBeGreaterThanOrEqual(57);
    expect(hasil.flatMap((h) => h.peringatan)).toEqual([]);
  });

  it('202607290001 membuat error_log, fungsi observability, dan cron alert (semua kuat)', () => {
    const p = dari('202607290001').penanda;
    expect(p.find((x) => x.kunci === 'tabel:public.error_log')).toMatchObject({ aksi: 'buat', kekuatan: 'kuat' });
    expect(p.find((x) => x.kunci === 'cron:observability_error_alert')).toMatchObject({ aksi: 'buat', kekuatan: 'kuat' });
  });

  it('catat_absensi 3 argumen (202607290011) digantikan 202610090001; 4 argumen dibuat 202610090001', () => {
    expect(dari('202607290011').penanda.find((x) => x.kunci === 'fungsi:public.catat_absensi/3'))
      .toMatchObject({ status: 'digantikan', digantikanOleh: '202610090001' });
    expect(dari('202610090001').penanda.find((x) => x.kunci === 'fungsi:public.catat_absensi/4'))
      .toMatchObject({ aksi: 'buat', status: 'aktif', kekuatan: 'kuat' });
  });

  it('202610090001 membuat bucket absensi-foto; 202608080002 mengubah tipe embedding ke vector(3072)', () => {
    expect(dari('202610090001').penanda.find((x) => x.kunci === 'bucket:absensi-foto')).toMatchObject({ aksi: 'buat' });
    expect(dari('202608080002').penanda.find((x) => x.kunci === 'tipe:public.faq_knowledge_base.embedding'))
      .toMatchObject({ aksi: 'buat', tipe: 'vector(3072)', status: 'aktif', kekuatan: 'kuat' });
  });

  it('202609020001: indeks idx_hari_libur_tanggal kuat; policy hari_libur_staff_write digantikan 202610080002', () => {
    const p = dari('202609020001').penanda;
    expect(p.find((x) => x.kunci === 'indeks:public.idx_hari_libur_tanggal')).toMatchObject({ aksi: 'buat', kekuatan: 'kuat' });
    expect(p.find((x) => x.kunci === 'policy:public.hari_libur:hari_libur_staff_write'))
      .toMatchObject({ status: 'digantikan', digantikanOleh: '202610080002' });
  });

  it('202608310003 adalah berkas no-op: tanpa penanda dan tanpa pernyataan', () => {
    expect(dari('202608310003').penanda).toEqual([]);
    expect(pecahPernyataan(berkas.find((b) => b.versi === '202608310003')!.sql)).toEqual([]);
  });

  it('pecahPernyataan menghasilkan jumlah pernyataan yang sama dengan kolom statements ledger produksi (kontrol 3 berkas kecil)', () => {
    // Jumlah di supabase_migrations.schema_migrations produksi: 202607240001 = 3, 202607280002 = 4, 202607280005 = 3.
    const n = (v: string) => pecahPernyataan(berkas.find((b) => b.versi === v)!.sql).length;
    expect(n('202607240001')).toBe(3);
    expect(n('202607280002')).toBe(4);
    expect(n('202607280005')).toBe(3);
  });
});
