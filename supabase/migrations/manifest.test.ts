// @vitest-environment node
//
// Kontrak T11: migrasi yang sudah ada TIDAK BOLEH diubah in-place. `MANIFEST.json` mencatat SHA-256
// tiap file `*.sql`; test ini gagal bila ada file yang berubah, hilang, belum terdaftar, bernama
// salah, atau memakai versi 12-digit ganda. Perbaikan = migrasi forward baru (lihat
// docs/ATURAN_MIGRASI.md). Logika pembanding ada di scripts/gen-migration-manifest.mjs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  POLA_NAMA,
  buatManifest,
  daftarBerkasSql,
  hashIsi,
  hitungHashFolder,
  normalisasiAkhirBaris,
  periksaManifest,
  periksaNama,
  serialisasiManifest,
} from '../../scripts/gen-migration-manifest.mjs';

const DIR_MIGRASI = dirname(fileURLToPath(import.meta.url));
const SKRIP = join(DIR_MIGRASI, '..', '..', 'scripts', 'gen-migration-manifest.mjs');

const PESAN_UBAH = (nama: string) => `migrasi lama diubah: ${nama} — buat migrasi forward baru, jangan edit in-place`;
const PESAN_BARU = 'file migrasi baru belum masuk manifest — jalankan `node scripts/gen-migration-manifest.mjs`';

// ---------------------------------------------------------------------------------------------
// 1. Fungsi pembanding murni, diuji dengan data buatan (tanpa menyentuh folder asli).
// ---------------------------------------------------------------------------------------------
describe('hash migrasi', () => {
  it('menyamakan CRLF dan LF (hasil sama di Windows/Linux, tahan core.autocrlf)', () => {
    const lf = 'CREATE TABLE a (id int);\nSELECT 1;\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(hashIsi(crlf)).toBe(hashIsi(lf));
    expect(hashIsi(Buffer.from(crlf))).toBe(hashIsi(Buffer.from(lf)));
  });

  it('tidak menyamakan CR tunggal / spasi akhir / baris kosong tambahan', () => {
    const dasar = 'SELECT 1;\n';
    expect(hashIsi('SELECT 1;\r')).not.toBe(hashIsi(dasar));
    expect(hashIsi('SELECT 1; \n')).not.toBe(hashIsi(dasar));
    expect(hashIsi('SELECT 1;\n\n')).not.toBe(hashIsi(dasar));
  });

  it('menghitung atas byte mentah: dua byte non-UTF-8 berbeda tidak bertabrakan', () => {
    expect(hashIsi(Buffer.from([0x80]))).not.toBe(hashIsi(Buffer.from([0x81])));
    expect(normalisasiAkhirBaris(Buffer.from([0x0d, 0x0a, 0xff])).equals(Buffer.from([0x0a, 0xff]))).toBe(true);
  });

  it('mengikuti SHA-256 standar (vektor uji "abc")', () => {
    expect(hashIsi('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('periksaManifest (fungsi murni)', () => {
  const hashA = hashIsi('A');
  const hashB = hashIsi('B');
  const manifest = buatManifest({ '202601010001_a.sql': hashA, '202601010002_b.sql': hashB });

  it('tanpa masalah bila manifest dan keadaan folder sama', () => {
    expect(periksaManifest(manifest, { '202601010001_a.sql': hashA, '202601010002_b.sql': hashB })).toEqual([]);
  });

  it('mendeteksi isi berkas berubah dengan pesan yang benar', () => {
    const masalah = periksaManifest(manifest, { '202601010001_a.sql': hashIsi('A!'), '202601010002_b.sql': hashB });
    expect(masalah).toHaveLength(1);
    expect(masalah[0].jenis).toBe('berubah');
    expect(masalah[0].pesan).toBe(PESAN_UBAH('202601010001_a.sql'));
  });

  it('mendeteksi berkas baru yang belum masuk manifest', () => {
    const masalah = periksaManifest(manifest, {
      '202601010001_a.sql': hashA,
      '202601010002_b.sql': hashB,
      '202601010003_c.sql': hashIsi('C'),
    });
    expect(masalah).toHaveLength(1);
    expect(masalah[0].jenis).toBe('belum_terdaftar');
    expect(masalah[0].pesan).toContain(PESAN_BARU);
    expect(masalah[0].pesan).toContain('202601010003_c.sql');
  });

  it('mendeteksi berkas di manifest yang hilang dari folder (dihapus / diganti nama)', () => {
    const masalah = periksaManifest(manifest, { '202601010001_a.sql': hashA });
    expect(masalah.map((m) => m.jenis)).toEqual(['hilang']);
    expect(masalah[0].nama).toBe('202601010002_b.sql');

    const diganti = periksaManifest(manifest, { '202601010001_a.sql': hashA, '202601010002_bb.sql': hashB });
    expect(diganti.map((m) => m.jenis).sort()).toEqual(['belum_terdaftar', 'hilang']);
  });

  it('menolak manifest rusak (bentuk salah / versi salah / hash bukan SHA-256)', () => {
    const aktual = { '202601010001_a.sql': hashA };
    for (const rusak of [null, undefined, 42, 'x', [], {}, { versi: 2, berkas: {} }, { versi: 1 }, { versi: 1, berkas: [] }]) {
      expect(periksaManifest(rusak, aktual).map((m) => m.jenis)).toEqual(['manifest_rusak']);
    }
    const hashPendek = periksaManifest({ versi: 1, berkas: { '202601010001_a.sql': 'abc' } }, aktual);
    expect(hashPendek.some((m) => m.jenis === 'manifest_rusak')).toBe(true);
  });

  it('mendeteksi nama tidak sesuai pola dan versi 12 digit ganda', () => {
    const buruk = [
      'tanpa_versi.sql',
      '20260101001_pendek.sql', // 11 digit
      '202601010001_Besar.sql', // huruf kapital
      '202601010001-strip.sql', // bukan underscore
      '202601010001_ok.SQL', // ekstensi huruf besar
      '202601010001_spasi nama.sql',
    ];
    const masalah = periksaNama(buruk);
    expect(masalah.map((m) => m.jenis)).toEqual(buruk.map(() => 'nama_tidak_valid'));

    const ganda = periksaNama(['202601010001_a.sql', '202601010001_b.sql', '202601010002_c.sql']);
    expect(ganda).toHaveLength(1);
    expect(ganda[0].jenis).toBe('versi_ganda');
    expect(ganda[0].pesan).toContain('202601010001');

    expect(periksaNama(['202601010001_a.sql', '202601010002_b.sql'])).toEqual([]);
  });

  it('pola nama menerima nama sah dan menolak yang lain', () => {
    expect(POLA_NAMA.test('202610090005_perbaikan_review.sql')).toBe(true);
    expect(POLA_NAMA.test('202610090005_perbaikan-review.sql')).toBe(false);
    expect(POLA_NAMA.test('202610090005_.sql')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Bukti deteksi pada folder fixture sementara (file sungguhan, hash sungguhan, CLI sungguhan).
// ---------------------------------------------------------------------------------------------
describe('deteksi perubahan pada folder fixture sementara', () => {
  let dir: string;
  const SQL_A = 'CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n';
  const SQL_B = 'ALTER TABLE a ADD COLUMN nama text;\n';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lmh-manifest-'));
    writeFileSync(join(dir, '202601010001_a.sql'), SQL_A);
    writeFileSync(join(dir, '202601010002_b.sql'), SQL_B);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const manifestFixture = () => buatManifest(hitungHashFolder(dir));
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [SKRIP, '--dir', dir, ...args], { encoding: 'utf8' });

  it('lolos pada keadaan awal', () => {
    expect(periksaManifest(manifestFixture(), hitungHashFolder(dir))).toEqual([]);
  });

  it('perubahan SATU karakter pada file memicu kegagalan', () => {
    const manifest = manifestFixture();
    writeFileSync(join(dir, '202601010001_a.sql'), SQL_A.replace('(1)', '(2)'));
    const masalah = periksaManifest(manifest, hitungHashFolder(dir));
    expect(masalah.map((m) => m.pesan)).toEqual([PESAN_UBAH('202601010001_a.sql')]);
  });

  it('menambah satu karakter (termasuk spasi / baris kosong di akhir) memicu kegagalan', () => {
    const manifest = manifestFixture();
    writeFileSync(join(dir, '202601010002_b.sql'), SQL_B + ' ');
    expect(periksaManifest(manifest, hitungHashFolder(dir)).map((m) => m.jenis)).toEqual(['berubah']);
  });

  it('mengubah akhir baris LF -> CRLF TIDAK memicu kegagalan (tahan core.autocrlf)', () => {
    const manifest = manifestFixture();
    writeFileSync(join(dir, '202601010001_a.sql'), SQL_A.replace(/\n/g, '\r\n'));
    expect(periksaManifest(manifest, hitungHashFolder(dir))).toEqual([]);
  });

  it('file .sql baru tanpa manifest memicu kegagalan', () => {
    const manifest = manifestFixture();
    writeFileSync(join(dir, '202601010003_c.sql'), 'SELECT 1;\n');
    const masalah = periksaManifest(manifest, hitungHashFolder(dir));
    expect(masalah.map((m) => m.jenis)).toEqual(['belum_terdaftar']);
    expect(masalah[0].pesan).toContain(PESAN_BARU);
  });

  it('file non-.sql (mis. *.test.ts) dan subfolder diabaikan', () => {
    writeFileSync(join(dir, 'a.test.ts'), '// bukan migrasi');
    mkdirSync(join(dir, 'sub.sql'));
    expect(daftarBerkasSql(dir)).toEqual(['202601010001_a.sql', '202601010002_b.sql']);
  });

  it('menghapus atau mengganti nama file memicu kegagalan', () => {
    const manifest = manifestFixture();
    rmSync(join(dir, '202601010002_b.sql'));
    expect(periksaManifest(manifest, hitungHashFolder(dir)).map((m) => m.jenis)).toEqual(['hilang']);
  });

  describe('CLI scripts/gen-migration-manifest.mjs', () => {
    it('mode tulis membuat MANIFEST.json terurut, berformat benar, dan --check lolos', () => {
      const tulis = cli();
      expect(tulis.status).toBe(0);
      const teks = readFileSync(join(dir, 'MANIFEST.json'), 'utf8');
      expect(teks).not.toContain('\r');
      expect(teks.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(teks);
      expect(parsed.versi).toBe(1);
      expect(Object.keys(parsed.berkas)).toEqual(['202601010001_a.sql', '202601010002_b.sql']);
      expect(teks).toBe(serialisasiManifest(buatManifest(hitungHashFolder(dir))));
      expect(cli('--check').status).toBe(0);
    });

    it('--check exit 1 dengan pesan "migrasi lama diubah" setelah edit 1 karakter, dan tidak menulis', () => {
      expect(cli().status).toBe(0);
      const sebelum = readFileSync(join(dir, 'MANIFEST.json'), 'utf8');
      writeFileSync(join(dir, '202601010001_a.sql'), SQL_A.replace('int', 'inx'));
      const hasil = cli('--check');
      expect(hasil.status).toBe(1);
      expect(hasil.stderr).toContain(PESAN_UBAH('202601010001_a.sql'));
      expect(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')).toBe(sebelum);
    });

    it('--check exit 1 untuk file baru, dan mode tulis hanya MENAMBAH entri baru', () => {
      expect(cli().status).toBe(0);
      const sebelum = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
      writeFileSync(join(dir, '202601010003_c.sql'), 'SELECT 1;\n');
      const periksa = cli('--check');
      expect(periksa.status).toBe(1);
      expect(periksa.stderr).toContain(PESAN_BARU);

      expect(cli().status).toBe(0);
      const sesudah = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
      expect(Object.keys(sesudah.berkas)).toEqual(['202601010001_a.sql', '202601010002_b.sql', '202601010003_c.sql']);
      for (const [nama, hash] of Object.entries(sebelum.berkas)) expect(sesudah.berkas[nama]).toBe(hash);
      expect(cli('--check').status).toBe(0);
    });

    it('mode tulis MENOLAK "mencuci" edit in-place: hash lama tidak diubah dan tidak ada yang ditulis', () => {
      expect(cli().status).toBe(0);
      const sebelum = readFileSync(join(dir, 'MANIFEST.json'), 'utf8');
      writeFileSync(join(dir, '202601010001_a.sql'), SQL_A + '-- diedit\n');
      const hasil = cli();
      expect(hasil.status).toBe(1);
      expect(hasil.stderr).toContain(PESAN_UBAH('202601010001_a.sql'));
      expect(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')).toBe(sebelum);
    });

    it('mode tulis menolak berkas yang hilang dan nama/versi tidak valid', () => {
      expect(cli().status).toBe(0);
      rmSync(join(dir, '202601010002_b.sql'));
      expect(cli().status).toBe(1);
      expect(cli('--check').status).toBe(1);

      writeFileSync(join(dir, '202601010002_b.sql'), SQL_B);
      writeFileSync(join(dir, 'NamaSalah.sql'), 'SELECT 1;\n');
      const salahNama = cli();
      expect(salahNama.status).toBe(1);
      expect(salahNama.stderr).toContain('NamaSalah.sql');
      rmSync(join(dir, 'NamaSalah.sql'));

      writeFileSync(join(dir, '202601010001_dobel.sql'), 'SELECT 1;\n');
      const dobel = cli();
      expect(dobel.status).toBe(1);
      expect(dobel.stderr).toContain('versi migrasi ganda');
    });

    it('--check tanpa MANIFEST.json = exit 1; argumen tak dikenal = exit 2', () => {
      expect(cli('--check').status).toBe(1);
      expect(cli('--sembarang').status).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Folder migrasi ASLI vs MANIFEST.json (inilah penjaga sebenarnya).
// ---------------------------------------------------------------------------------------------
describe('supabase/migrations/MANIFEST.json vs berkas asli', () => {
  const manifest = JSON.parse(readFileSync(join(DIR_MIGRASI, 'MANIFEST.json'), 'utf8'));
  const aktual = hitungHashFolder(DIR_MIGRASI);
  const masalah = periksaManifest(manifest, aktual);
  const pesanJenis = (jenis: string) => masalah.filter((m) => m.jenis === jenis).map((m) => m.pesan);

  it('manifest berbentuk benar: versi 1, terurut menurut nama, hash SHA-256', () => {
    expect(pesanJenis('manifest_rusak')).toEqual([]);
    const nama = Object.keys(manifest.berkas);
    expect(nama.length).toBeGreaterThan(0);
    expect(nama).toEqual([...nama].sort());
  });

  it('(a) setiap migrasi di manifest ada di folder dan hash-nya cocok', () => {
    expect(pesanJenis('berubah')).toEqual([]);
  });

  it('(b) setiap file .sql di folder terdaftar di manifest', () => {
    expect(pesanJenis('belum_terdaftar')).toEqual([]);
  });

  it('(c) nama file mengikuti pola 12 digit + snake_case dan versi unik', () => {
    expect(pesanJenis('nama_tidak_valid')).toEqual([]);
    expect(pesanJenis('versi_ganda')).toEqual([]);
    const versi = Object.keys(aktual).map((n) => n.slice(0, 12));
    expect(new Set(versi).size).toBe(versi.length);
    for (const nama of Object.keys(aktual)) expect(nama).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
  });

  it('(d) tidak ada berkas di manifest yang hilang dari folder', () => {
    expect(pesanJenis('hilang')).toEqual([]);
  });

  it('seluruhnya tanpa masalah', () => {
    expect(masalah.map((m) => m.pesan)).toEqual([]);
  });
});
