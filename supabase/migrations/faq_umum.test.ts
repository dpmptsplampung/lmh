// @vitest-environment node
// Kontrak statis migrasi 202610130001_faq_umum (tidak mengeksekusi SQL; tidak menyentuh database).
// Spec: docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.3. Rollback: docs/rollback-faq-umum-202610130001.sql.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610130001_faq_umum.sql';
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
const rollbackRaw = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-faq-umum-202610130001.sql'), 'utf8');
const rollback = stripSqlComments(rollbackRaw);

// Definisi SEBELUMNYA (sumber salinan).
const lamaTeksSql = stripSqlComments(baca('202609230002_faq_fts.sql'));
const lamaFaqSql = stripSqlComments(baca('202608080002_faq_embedding_3072.sql'));

describe('FAQ umum: atomik, idempoten, hanya menyentuh yang direncanakan', () => {
  it('tanpa BEGIN/COMMIT (file maupun rollback) dan terdeteksi sebagai perubahan policy/fungsi (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610130001_faq_umum\.sql --atomic --dry-run/);
  });

  it('daftar pernyataan persis: tidak ada tabel lain, data, trigger, atau policy lain yang disentuh', () => {
    const awal = pecahPernyataan(sql)
      .map((p: string) =>
        rapikan(p).match(
          /^(ALTER TABLE [\w.]+ ALTER COLUMN \w+ DROP NOT NULL|COMMENT ON COLUMN [\w.]+|DROP POLICY IF EXISTS \w+ ON [\w.]+|CREATE POLICY \w+ ON [\w.]+|CREATE OR REPLACE FUNCTION [\w.]+|REVOKE (?:ALL|EXECUTE) ON FUNCTION [\w.]+|GRANT EXECUTE ON FUNCTION [\w.]+)/,
        )?.[1] ?? `TAK DIKENAL: ${rapikan(p).slice(0, 80)}`,
      );
    expect(awal).toEqual([
      'ALTER TABLE public.faq_knowledge_base ALTER COLUMN layanan_id DROP NOT NULL',
      'COMMENT ON COLUMN public.faq_knowledge_base.layanan_id',
      'DROP POLICY IF EXISTS faq_fo_umum ON public.faq_knowledge_base',
      'CREATE POLICY faq_fo_umum ON public.faq_knowledge_base',
      'CREATE OR REPLACE FUNCTION public.match_faq_teks',
      'REVOKE ALL ON FUNCTION public.match_faq_teks',
      'GRANT EXECUTE ON FUNCTION public.match_faq_teks',
      'CREATE OR REPLACE FUNCTION public.match_faq',
      'REVOKE EXECUTE ON FUNCTION public.match_faq',
      'GRANT EXECUTE ON FUNCTION public.match_faq',
    ]);
  });

  it('idempoten: DROP POLICY IF EXISTS sebelum CREATE POLICY, CREATE OR REPLACE (tanpa DROP FUNCTION)', () => {
    const drop = sql.search(/DROP POLICY IF EXISTS faq_fo_umum ON public\.faq_knowledge_base/);
    const create = sql.search(/CREATE POLICY faq_fo_umum ON public\.faq_knowledge_base/);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
    expect(sql).not.toMatch(/DROP\s+FUNCTION/i);
    expect(sql).not.toMatch(/CREATE\s+FUNCTION/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+IF\s+NOT\s+EXISTS/i);
  });
});

describe('FAQ umum: kolom layanan_id nullable', () => {
  it('DROP NOT NULL pada faq_knowledge_base.layanan_id, tanpa SET NOT NULL / ADD / DROP COLUMN', () => {
    expect(sql).toMatch(/ALTER TABLE public\.faq_knowledge_base ALTER COLUMN layanan_id DROP NOT NULL;/);
    expect(sql).not.toMatch(/SET\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN|DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(?!public\.faq_knowledge_base\b)/i);
  });

  it('asumsi skema: kolom awalnya NOT NULL dengan FK ke layanan (CASCADE), NULL tetap sah untuk FK', () => {
    const fitur = stripSqlComments(baca('202607140003_feature_schema.sql'));
    const tabel = fitur.match(/CREATE TABLE public\.faq_knowledge_base \([\s\S]*?\);/)![0];
    expect(tabel).toMatch(/layanan_id uuid NOT NULL REFERENCES public\.layanan\(id\) ON DELETE CASCADE/);
  });
});

describe('FAQ umum: policy faq_fo_umum', () => {
  const policy = sql.match(/CREATE POLICY faq_fo_umum[\s\S]*?;/i)![0];
  const using = policy.match(/USING\s*\(([\s\S]*?)\)\s*WITH CHECK/i)![1];
  const check = policy.match(/WITH CHECK\s*\(([\s\S]*)\)\s*;/i)![1];
  const KONDISI = "layanan_id IS NULL AND public.get_my_role() = 'front_office'";

  it('FOR ALL TO authenticated; USING dan WITH CHECK sama: baris umum DAN peran front_office', () => {
    expect(policy).toMatch(/ON public\.faq_knowledge_base FOR ALL TO authenticated/i);
    expect(rapikan(using)).toBe(KONDISI);
    expect(rapikan(check)).toBe(KONDISI);
  });

  it('hanya front_office: tanpa admin/petugas, tanpa get_my_layanan_id, tanpa OR yang melonggarkan', () => {
    expect(policy).not.toMatch(/admin|petugas|get_my_layanan_id|\bOR\b|\btrue\b/i);
  });

  it('tidak ada policy lain yang dibuat/dihapus/diubah (faq_petugas_all, faq_admin_all, faq_public_read utuh)', () => {
    const semua = [...sql.matchAll(/\b(?:CREATE|DROP|ALTER)\s+POLICY\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+([\w.]+)/gi)].map((m) => `${m[1]}@${m[2]}`);
    expect(semua).toEqual(['faq_fo_umum@public.faq_knowledge_base', 'faq_fo_umum@public.faq_knowledge_base']);
    expect(sql).not.toMatch(/faq_petugas_all|faq_admin_all|faq_public_read/);
  });

  it('petugas tidak menjangkau baris umum: setiap definisi faq_petugas_all murni `layanan_id = get_my_layanan_id()`', () => {
    // NULL = x bernilai NULL (bukan true) pada RLS, sehingga baris umum dan petugas tanpa layanan (NULL = NULL)
    // tidak lolos. Penjaga ini gagal bila definisi policy itu kelak diberi penanganan NULL.
    const definisi = listMigrationFiles()
      .filter((nama) => nama <= BERKAS)
      .flatMap((nama) => [...stripSqlComments(baca(nama)).matchAll(/CREATE POLICY\s+"?faq_petugas_all"?[\s\S]*?;/gi)].map((m) => m[0]));
    expect(definisi.length).toBeGreaterThan(0);
    for (const d of definisi) {
      expect(d).toMatch(/USING\s*\(\s*layanan_id\s*=\s*public\.get_my_layanan_id\(\)\s*\)/i);
      expect(d).toMatch(/WITH CHECK\s*\(\s*layanan_id\s*=\s*public\.get_my_layanan_id\(\)\s*\)/i);
      expect(d).not.toMatch(/IS\s+NULL|IS\s+NOT\s+DISTINCT|COALESCE/i);
    }
  });

  it('get_my_role() mengembalikan NULL untuk akun nonaktif/non-staf (gagal tertutup bagi policy ini)', () => {
    const fungsi = stripSqlComments(baca('202607290004_petugas_aktif.sql')).match(/CREATE OR REPLACE FUNCTION public\.get_my_role\(\)[\s\S]*?\$\$;/i)![0];
    expect(fungsi).toMatch(/staff\.auth_user_id = auth\.uid\(\) AND staff\.aktif = true/);
  });
});

describe('FAQ umum: match_faq_teks (FTS) mencakup FAQ umum', () => {
  const baru = ambilFungsi(sql, 'match_faq_teks');
  const lama = ambilFungsi(lamaTeksSql, 'match_faq_teks');

  it('kondisi layanan = layanan diminta ATAU umum; FAQ layanan diurutkan sebelum FAQ umum pada skor setara', () => {
    expect(baru).toMatch(/AND \(f\.layanan_id = p_layanan OR f\.layanan_id IS NULL\)/);
    expect(rapikan(baru)).toContain('ORDER BY skor DESC, (f.layanan_id IS NULL) LIMIT');
    expect(baru).toMatch(/f\.aktif = true/);
  });

  it('hanya DUA perubahan dari definisi lama (202609230002): kondisi layanan dan kunci urut sekunder', () => {
    expect(rapikan(lama)).toContain('AND f.layanan_id = p_layanan');
    expect(rapikan(lama)).toContain('ORDER BY skor DESC LIMIT');
    const diharapkan = rapikan(lama)
      .replace('AND f.layanan_id = p_layanan', 'AND (f.layanan_id = p_layanan OR f.layanan_id IS NULL)')
      .replace('ORDER BY skor DESC LIMIT', 'ORDER BY skor DESC, (f.layanan_id IS NULL) LIMIT');
    expect(rapikan(baru)).toBe(diharapkan);
  });

  it('tanda tangan, kolom hasil, SECURITY DEFINER, search_path, dan REVOKE/GRANT identik dengan 202609230002', () => {
    expect(baru).toMatch(/\(\s*p_layanan uuid,\s*p_q text,\s*p_limit integer DEFAULT 5\s*\)/);
    expect(baru).toMatch(/RETURNS TABLE\(id uuid, pertanyaan text, jawaban text, skor double precision\)/);
    expect(baru).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER/);
    expect(baru).toMatch(/SET search_path = pg_catalog, public\s/);
    expect(rapikan(ambilHak(sql, 'REVOKE', 'match_faq_teks'))).toBe(rapikan(ambilHak(lamaTeksSql, 'REVOKE', 'match_faq_teks')));
    expect(rapikan(ambilHak(sql, 'GRANT', 'match_faq_teks'))).toBe(rapikan(ambilHak(lamaTeksSql, 'GRANT', 'match_faq_teks')));
    expect(ambilHak(sql, 'REVOKE', 'match_faq_teks')).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon;/);
    expect(ambilHak(sql, 'GRANT', 'match_faq_teks')).toMatch(/TO authenticated, service_role;/);
  });
});

describe('FAQ umum: match_faq (embedding 3072-dim) mencakup FAQ umum', () => {
  const baru = ambilFungsi(sql, 'match_faq');
  const lama = ambilFungsi(lamaFaqSql, 'match_faq');

  it('dengan p_layanan_id: layanan itu ATAU umum; tanpa p_layanan_id (NULL): semua baris seperti dulu', () => {
    expect(baru).toMatch(/AND \(p_layanan_id IS NULL OR faq\.layanan_id = p_layanan_id OR faq\.layanan_id IS NULL\)/);
    expect(baru).toMatch(/faq\.embedding IS NOT NULL/);
    expect(baru).toMatch(/faq\.aktif = true/);
    expect(rapikan(baru)).toContain('query_embedding, (faq.layanan_id IS NULL) LIMIT match_count');
  });

  it('hanya TIGA perubahan dari definisi lama (202608080002): CREATE OR REPLACE, kondisi layanan, kunci urut sekunder', () => {
    expect(rapikan(lama)).toMatch(/^CREATE FUNCTION public\.match_faq\(/);
    expect(rapikan(lama)).toContain('AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id)');
    expect(rapikan(lama)).toContain('ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding LIMIT');
    const diharapkan = rapikan(lama)
      .replace('CREATE FUNCTION public.match_faq(', 'CREATE OR REPLACE FUNCTION public.match_faq(')
      .replace(
        'AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id)',
        'AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id OR faq.layanan_id IS NULL)',
      )
      .replace(
        'ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding LIMIT',
        'ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding, (faq.layanan_id IS NULL) LIMIT',
      );
    expect(rapikan(baru)).toBe(diharapkan);
  });

  it('tanda tangan 3072-dim, kolom hasil (layanan_id bisa NULL), SECURITY DEFINER, search_path, REVOKE/GRANT identik', () => {
    expect(baru).toMatch(/query_embedding extensions\.vector\(3072\),\s*p_layanan_id uuid DEFAULT NULL,\s*match_count integer DEFAULT 5/);
    expect(baru).not.toMatch(/vector\(768\)/);
    expect(baru).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER/);
    expect(baru).toMatch(/SET search_path = pg_catalog, public, extensions\s/);
    expect(rapikan(ambilHak(sql, 'REVOKE', 'match_faq'))).toBe(rapikan(ambilHak(lamaFaqSql, 'REVOKE', 'match_faq')));
    expect(rapikan(ambilHak(sql, 'GRANT', 'match_faq'))).toBe(rapikan(ambilHak(lamaFaqSql, 'GRANT', 'match_faq')));
    expect(ambilHak(sql, 'REVOKE', 'match_faq')).toMatch(/FROM PUBLIC, anon, authenticated;/);
    expect(ambilHak(sql, 'GRANT', 'match_faq')).toMatch(/TO authenticated;/);
  });

  it('definisi lama yang disalin memang yang TERAKHIR (tidak ada migrasi lain yang mendefinisikan ulang sebelum versi ini)', () => {
    const sebelum = listMigrationFiles().filter((nama) => nama < BERKAS);
    const definisi = (re: RegExp) => sebelum.filter((nama) => re.test(stripSqlComments(baca(nama))));
    expect(definisi(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.match_faq_teks\b/i).at(-1)).toBe('202609230002_faq_fts.sql');
    expect(definisi(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.match_faq\s*\(/i).at(-1)).toBe('202608080002_faq_embedding_3072.sql');
  });
});

describe('FAQ umum: rollback', () => {
  it('penjaga data: melempar galat bila masih ada FAQ umum, SEBELUM perubahan apa pun dan sebelum SET NOT NULL', () => {
    const doBlok = rollback.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/FROM public\.faq_knowledge_base WHERE layanan_id IS NULL/);
    expect(doBlok).toMatch(/RAISE EXCEPTION/);
    const iDo = rollback.search(/DO \$\$/);
    expect(iDo).toBeGreaterThanOrEqual(0);
    expect(rollback.search(/CREATE OR REPLACE FUNCTION/)).toBeGreaterThan(iDo);
    expect(rollback.search(/DROP POLICY/)).toBeGreaterThan(iDo);
    expect(rollback.search(/SET NOT NULL/)).toBeGreaterThan(iDo);
  });

  it('tidak menghapus/mengubah data FAQ (tanpa DELETE/UPDATE/INSERT/TRUNCATE)', () => {
    expect(rollback).not.toMatch(/\b(?:DELETE\s+FROM|UPDATE\s+public\.|INSERT\s+INTO|TRUNCATE)\b/i);
  });

  it('mengembalikan SET NOT NULL, menghapus policy faq_fo_umum, dan menghapus komentar kolom', () => {
    expect(rollback).toMatch(/DROP POLICY IF EXISTS faq_fo_umum ON public\.faq_knowledge_base;/);
    expect(rollback).toMatch(/ALTER TABLE public\.faq_knowledge_base ALTER COLUMN layanan_id SET NOT NULL;/);
    expect(rollback).toMatch(/COMMENT ON COLUMN public\.faq_knowledge_base\.layanan_id IS NULL;/);
    expect(rollback).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it('mengembalikan kedua fungsi PERSIS ke definisi lama beserta REVOKE/GRANT', () => {
    expect(rapikan(ambilFungsi(rollback, 'match_faq_teks'))).toBe(rapikan(ambilFungsi(lamaTeksSql, 'match_faq_teks')));
    expect(rapikan(ambilFungsi(rollback, 'match_faq'))).toBe(
      rapikan(ambilFungsi(lamaFaqSql, 'match_faq')).replace('CREATE FUNCTION public.match_faq(', 'CREATE OR REPLACE FUNCTION public.match_faq('),
    );
    for (const kata of ['REVOKE', 'GRANT'] as const) {
      expect(rapikan(ambilHak(rollback, kata, 'match_faq_teks'))).toBe(rapikan(ambilHak(lamaTeksSql, kata, 'match_faq_teks')));
      expect(rapikan(ambilHak(rollback, kata, 'match_faq'))).toBe(rapikan(ambilHak(lamaFaqSql, kata, 'match_faq')));
    }
  });
});

describe('FAQ umum: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di docs/MIGRATIONS.md dan docs/analysis/DB-CHANGES.md sebagai belum diterapkan', () => {
    expect(bacaDocs('MIGRATIONS.md')).toContain('202610130001_faq_umum');
    const dbChanges = bacaDocs('analysis', 'DB-CHANGES.md');
    expect(dbChanges).toContain('202610130001_faq_umum');
    expect(dbChanges).toMatch(/202610130001_faq_umum[\s\S]{0,1500}BELUM DITERAPKAN/);
  });
});
