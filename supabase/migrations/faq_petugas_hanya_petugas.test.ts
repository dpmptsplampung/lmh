// @vitest-environment node
// Kontrak statis migrasi 202610130002_faq_petugas_hanya_petugas (tidak mengeksekusi SQL; tidak menyentuh database).
// Menutup celah: faq_petugas_all (202607280003) tidak memeriksa peran, sehingga Front Office ber-layanan_id
// lolos policy itu. Rollback: docs/rollback-faq-petugas-hanya-petugas-202610130002.sql.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610130002_faq_petugas_hanya_petugas.sql';
const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const rollbackRaw = bacaDocs('rollback-faq-petugas-hanya-petugas-202610130002.sql');
const rollback = stripSqlComments(rollbackRaw);

type Kebijakan = { nama: string; using: string; check: string; kepala: string };

/** Ambil `CREATE POLICY <nama> ... USING (...) WITH CHECK (...);` dari SQL yang sudah bebas komentar. */
function ambilPolicy(teks: string, nama: string): Kebijakan {
  const stmt = teks.match(new RegExp(`CREATE POLICY\\s+"?${nama}"?\\s+ON[\\s\\S]*?;`, 'i'));
  if (!stmt) throw new Error(`policy ${nama} tidak ditemukan`);
  const m = stmt[0].match(/^(CREATE POLICY[\s\S]*?)USING\s*\(([\s\S]*?)\)\s*WITH CHECK\s*\(([\s\S]*)\)\s*;$/i);
  if (!m) throw new Error(`policy ${nama}: bentuk USING/WITH CHECK tak dikenal`);
  return { nama, kepala: rapikan(m[1]), using: rapikan(m[2]), check: rapikan(m[3]) };
}

const PETUGAS_LAMA = ambilPolicy(stripSqlComments(baca('202607280003_faq_petugas_scope.sql')), 'faq_petugas_all');
const PETUGAS_BARU = ambilPolicy(sql, 'faq_petugas_all');
const ADMIN = ambilPolicy(stripSqlComments(baca('202607140004_security_and_automation.sql')), 'faq_admin_all');
const FO = ambilPolicy(stripSqlComments(baca('202610130001_faq_umum.sql')), 'faq_fo_umum');

// ---------------------------------------------------------------------------------------------
// Simulator logis sederhana untuk ekspresi RLS: atom-atom dihubungkan AND, logika tiga nilai SQL
// (true/false/null). Policy lolos hanya bila hasilnya TEPAT true. Bukan parser Postgres: ekspresi di luar
// atom yang dikenal melempar galat sehingga test gagal alih-alih lolos diam-diam. Hanya policy yang bisa
// memberi hak TULIS yang dimodelkan (faq_admin_all, faq_petugas_all, faq_fo_umum); faq_public_read (SELECT
// baris aktif untuk semua orang) tidak dimodelkan, sehingga "select" di bawah = jangkauan policy kelola saja.
// ---------------------------------------------------------------------------------------------
type Nilai = boolean | null;
type Konteks = { role: string | null; layananSaya: string | null; layananBaris: string | null };

function atom(a: string, k: Konteks): Nilai {
  const teks = rapikan(a);
  if (teks === 'layanan_id IS NULL') return k.layananBaris === null;
  if (teks === 'layanan_id = public.get_my_layanan_id()') {
    return k.layananBaris === null || k.layananSaya === null ? null : k.layananBaris === k.layananSaya;
  }
  const peran = teks.match(/^public\.get_my_role\(\) = '(\w+)'$/);
  if (peran) return k.role === null ? null : k.role === peran[1];
  throw new Error(`atom RLS tak dikenal: ${teks}`);
}

function evaluasi(ekspresi: string, k: Konteks): Nilai {
  expect(ekspresi).not.toMatch(/\bOR\b|\bNOT\b/i); // simulator hanya memahami AND
  const hasil = ekspresi.split(/\s+AND\s+/i).map((a) => atom(a, k));
  if (hasil.includes(false)) return false;
  return hasil.includes(null) ? null : true;
}

type Perintah = 'insert' | 'select' | 'update' | 'delete';
type Baris = string | null; // layanan_id baris; null = FAQ umum

/** Apakah `peran` (dengan baris petugas ber-layanan `layananSaya`) boleh melakukan perintah ini. */
function boleh(policies: Kebijakan[], perintah: Perintah, role: string | null, layananSaya: string | null, lama: Baris, baru: Baris): boolean {
  const lolos = (ekspr: (p: Kebijakan) => string, baris: Baris) =>
    policies.some((p) => evaluasi(ekspr(p), { role, layananSaya, layananBaris: baris }) === true);
  const usingOk = () => lolos((p) => p.using, lama);
  const checkOk = () => lolos((p) => p.check, baru);
  if (perintah === 'insert') return checkOk();
  if (perintah === 'select' || perintah === 'delete') return usingOk();
  return usingOk() && checkOk(); // update: baris lama lolos USING DAN baris baru lolos WITH CHECK
}

const A = 'A'; // id layanan (label singkat)
const B = 'B';
const BARIS: Baris[] = [A, B, null];
const PERINTAH: Perintah[] = ['insert', 'select', 'update', 'delete'];

/** Semua kombinasi (perintah, baris lama, baris baru) yang diizinkan, sebagai string deterministik. */
function izin(policies: Kebijakan[], role: string | null, layananSaya: string | null): string[] {
  const hasil: string[] = [];
  for (const perintah of PERINTAH) {
    for (const lama of BARIS) {
      for (const baru of BARIS) {
        if (perintah !== 'update' && baru !== lama) continue; // hanya update yang membedakan baris lama/baru
        if (boleh(policies, perintah, role, layananSaya, lama, baru)) {
          hasil.push(`${perintah}:${lama ?? 'umum'}->${baru ?? 'umum'}`);
        }
      }
    }
  }
  return hasil;
}

describe('faq petugas hanya petugas: atomik, idempoten, hanya menyentuh policy FAQ', () => {
  it('tanpa BEGIN/COMMIT (file maupun rollback) dan terdeteksi sebagai perubahan policy (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610130002_faq_petugas_hanya_petugas\.sql --atomic --dry-run/);
  });

  it('daftar pernyataan persis dua: DROP POLICY IF EXISTS lalu CREATE POLICY faq_petugas_all pada faq_knowledge_base', () => {
    const pernyataan = pecahPernyataan(sql).map(rapikan);
    expect(pernyataan).toHaveLength(2);
    expect(pernyataan[0]).toBe('DROP POLICY IF EXISTS faq_petugas_all ON public.faq_knowledge_base');
    expect(pernyataan[1]).toMatch(/^CREATE POLICY faq_petugas_all ON public\.faq_knowledge_base FOR ALL TO authenticated USING \(/);
  });

  it('idempoten dan tidak menyentuh apa pun selain faq_petugas_all (tanpa fungsi, kolom, data, policy lain)', () => {
    expect(sql.search(/DROP POLICY IF EXISTS/)).toBeLessThan(sql.search(/CREATE POLICY/));
    const semua = [...sql.matchAll(/\b(?:CREATE|DROP|ALTER)\s+POLICY\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+([\w.]+)/gi)].map((m) => `${m[1]}@${m[2]}`);
    expect(semua).toEqual(['faq_petugas_all@public.faq_knowledge_base', 'faq_petugas_all@public.faq_knowledge_base']);
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+IF\s+NOT\s+EXISTS/i);
    expect(sql).not.toMatch(/\bFUNCTION\b|\bALTER\s+TABLE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b/i);
    expect(sql).not.toMatch(/faq_admin_all|faq_public_read|faq_fo_umum/);
  });
});

describe('faq petugas hanya petugas: definisi policy faq_petugas_all', () => {
  it('nama, FOR ALL, dan TO authenticated dipertahankan dari definisi lama', () => {
    expect(PETUGAS_BARU.kepala).toBe('CREATE POLICY faq_petugas_all ON public.faq_knowledge_base FOR ALL TO authenticated');
    expect(PETUGAS_LAMA.kepala.replace(/"/g, '')).toBe(PETUGAS_BARU.kepala);
  });

  it('USING dan WITH CHECK memuat KEDUA klausa: layanan sendiri DAN peran petugas', () => {
    const KONDISI = "layanan_id = public.get_my_layanan_id() AND public.get_my_role() = 'petugas'";
    expect(PETUGAS_BARU.using).toBe(KONDISI);
    expect(PETUGAS_BARU.check).toBe(KONDISI);
  });

  it('klausa layanan identik dengan definisi lama; satu-satunya tambahan ialah klausa peran (tanpa OR/penanganan NULL)', () => {
    expect(PETUGAS_LAMA.using).toBe('layanan_id = public.get_my_layanan_id()');
    expect(PETUGAS_LAMA.check).toBe('layanan_id = public.get_my_layanan_id()');
    for (const ekspr of [PETUGAS_BARU.using, PETUGAS_BARU.check]) {
      expect(ekspr.startsWith(`${PETUGAS_LAMA.using} AND `)).toBe(true);
      expect(ekspr).not.toMatch(/\bOR\b|IS\s+NULL|IS\s+NOT\s+DISTINCT|COALESCE|\btrue\b|admin|front_office/i);
    }
  });

  it('asumsi fungsi: get_my_role() dan get_my_layanan_id() hanya mengembalikan nilai untuk petugas AKTIF (definisi terbaru)', () => {
    const role = stripSqlComments(baca('202607290004_petugas_aktif.sql')).match(/CREATE OR REPLACE FUNCTION public\.get_my_role\(\)[\s\S]*?\$\$;/i)![0];
    expect(role).toMatch(/staff\.auth_user_id = auth\.uid\(\) AND staff\.aktif = true/);
    const layanan = stripSqlComments(baca('202610080001_rbac_tahap0_keamanan.sql')).match(/CREATE OR REPLACE FUNCTION public\.get_my_layanan_id\(\)[\s\S]*?\$\$;/i)![0];
    expect(layanan).toMatch(/SELECT staff\.layanan_id FROM public\.petugas AS staff\s+WHERE staff\.auth_user_id = auth\.uid\(\) AND staff\.aktif = true/);
    // Tidak ada peran dalam get_my_layanan_id(): itulah sebab policy lama bocor ke Front Office.
    expect(layanan).not.toMatch(/\brole\b/);
  });

  it('definisi terbaru yang disalin memang yang terakhir: tidak ada migrasi lain yang membuat/mengubah faq_petugas_all', () => {
    const definisi = listMigrationFiles().filter((nama) => /POLICY\s+(?:IF\s+EXISTS\s+)?"?faq_petugas_all"?/i.test(stripSqlComments(baca(nama))));
    expect(definisi).toEqual(['202607280003_faq_petugas_scope.sql', BERKAS]);
  });
});

describe('faq petugas hanya petugas: gabungan policy tidak memberi Front Office jalur ke baris layanan', () => {
  const SEBELUM = [ADMIN, PETUGAS_LAMA, FO];
  const SESUDAH = [ADMIN, PETUGAS_BARU, FO];

  it('simulator valid: pada policy LAMA, FO ber-layanan memang bisa menulis FAQ layanan dan memindahkan baris (bukti celah)', () => {
    const fo = izin(SEBELUM, 'front_office', A);
    expect(fo).toContain('insert:A->A');
    expect(fo).toContain('update:A->A');
    expect(fo).toContain('delete:A->A');
    expect(fo).toContain('update:A->umum'); // pindah layanan -> umum
    expect(fo).toContain('update:umum->A'); // pindah umum -> layanan
  });

  it('SESUDAH: FO (dengan atau tanpa layanan_id di baris petugas-nya) hanya boleh pada baris umum', () => {
    for (const layananSaya of [A, B, null]) {
      const fo = izin(SESUDAH, 'front_office', layananSaya);
      expect(fo).toEqual(['insert:umum->umum', 'select:umum->umum', 'update:umum->umum', 'delete:umum->umum']);
    }
  });

  it('SESUDAH: tidak ada jalur FO yang memindahkan baris antara umum dan layanan (USING maupun WITH CHECK)', () => {
    for (const layananSaya of [A, B, null]) {
      const fo = izin(SESUDAH, 'front_office', layananSaya);
      expect(fo.filter((x) => x.startsWith('update:') && x !== 'update:umum->umum')).toEqual([]);
      expect(fo.some((x) => x.includes(`:${A}`) || x.includes(`:${B}`) || x.includes(`>${A}`) || x.includes(`>${B}`))).toBe(false);
    }
  });

  it('SESUDAH: petugas aktif ber-layanan A tetap persis seperti sebelumnya (hanya baris layanan A, tanpa baris umum/layanan lain)', () => {
    const diharapkan = ['insert:A->A', 'select:A->A', 'update:A->A', 'delete:A->A'];
    expect(izin(SESUDAH, 'petugas', A)).toEqual(diharapkan);
    expect(izin(SEBELUM, 'petugas', A)).toEqual(diharapkan);
  });

  it('SESUDAH: petugas tanpa layanan, akun nonaktif/non-staf (role NULL) tidak punya akses tulis sama sekali', () => {
    expect(izin(SESUDAH, 'petugas', null)).toEqual([]);
    expect(izin(SESUDAH, null, null)).toEqual([]);
    expect(izin(SESUDAH, null, A)).toEqual([]);
  });

  it('SESUDAH: admin tetap bisa semua baris dan semua perpindahan (lewat faq_admin_all)', () => {
    const admin = izin(SESUDAH, 'admin', null);
    expect(admin).toEqual(izin(SEBELUM, 'admin', null));
    expect(admin).toContain('update:A->umum');
    expect(admin).toContain('update:umum->B');
    expect(admin).toContain('insert:umum->umum');
    // Admin yang baris petugas-nya masih punya layanan_id tidak mendapat apa pun yang berbeda.
    expect(izin(SESUDAH, 'admin', A)).toEqual(admin);
  });

  it('SESUDAH: tidak ada peran selain admin yang menyentuh baris layanan lain atau memindahkan baris', () => {
    for (const role of ['petugas', 'front_office', null]) {
      for (const layananSaya of [A, B, null]) {
        const hasil = izin(SESUDAH, role, layananSaya);
        for (const x of hasil) {
          const [perintah, jalur] = x.split(':');
          const [lama, baru] = jalur.split('->');
          if (role === 'petugas') expect(lama === layananSaya && baru === layananSaya).toBe(true);
          if (role === 'front_office') expect(lama === 'umum' && baru === 'umum').toBe(true);
          expect(perintah === 'update' ? lama === baru : true).toBe(true);
        }
      }
    }
  });
});

describe('faq petugas hanya petugas: rollback', () => {
  it('memulihkan faq_petugas_all PERSIS ke definisi 202607280003 (nama, FOR ALL, TO authenticated, USING, WITH CHECK)', () => {
    const pulih = ambilPolicy(rollback, 'faq_petugas_all');
    expect(pulih.kepala).toBe(PETUGAS_LAMA.kepala.replace(/"/g, ''));
    expect(pulih.using).toBe(PETUGAS_LAMA.using);
    expect(pulih.check).toBe(PETUGAS_LAMA.check);
    expect(pulih.using).not.toMatch(/get_my_role/);
  });

  it('idempoten (DROP POLICY IF EXISTS dulu) dan hanya menyentuh faq_petugas_all', () => {
    const pernyataan = pecahPernyataan(rollback).map(rapikan);
    expect(pernyataan).toHaveLength(2);
    expect(pernyataan[0]).toBe('DROP POLICY IF EXISTS faq_petugas_all ON public.faq_knowledge_base');
    expect(pernyataan[1]).toMatch(/^CREATE POLICY faq_petugas_all ON public\.faq_knowledge_base FOR ALL TO authenticated/);
    expect(rollback).not.toMatch(/\bFUNCTION\b|\bALTER\s+TABLE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  });
});

describe('faq petugas hanya petugas: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di docs/MIGRATIONS.md dan docs/analysis/DB-CHANGES.md dengan status penerapan dan urutan penerapan', () => {
    expect(bacaDocs('MIGRATIONS.md')).toContain('202610130002_faq_petugas_hanya_petugas');
    const dbChanges = bacaDocs('analysis', 'DB-CHANGES.md');
    expect(dbChanges).toContain('202610130002_faq_petugas_hanya_petugas');
    expect(dbChanges).toMatch(/202610130002_faq_petugas_hanya_petugas[\s\S]{0,3000}(?:BELUM )?DITERAPKAN/);
    expect(dbChanges).toMatch(/202610130001[\s\S]{0,400}202610130002/);
  });
});
