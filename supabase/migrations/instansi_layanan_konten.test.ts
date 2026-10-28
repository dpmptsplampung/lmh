// @vitest-environment node
//
// Kontrak statis migrasi 202610270001 (Fase 1: model konten Layanan dinamis). Tes ini hanya membaca
// teks SQL; tidak ada SQL yang dieksekusi ke database.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610270001_instansi_layanan_konten.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

describe('202610270001_instansi_layanan_konten migration', () => {
  it('membuat tabel instansi dan layanan_tautan dengan CHECK panjang & https', () => {
    const instansi = bare.match(/CREATE TABLE IF NOT EXISTS public\.instansi\s*\(([\s\S]*?)\n\);/i)?.[1];
    const tautan = bare.match(/CREATE TABLE IF NOT EXISTS public\.layanan_tautan\s*\(([\s\S]*?)\n\);/i)?.[1];
    expect(instansi).toBeDefined();
    expect(tautan).toBeDefined();
    expect(instansi).toMatch(/nama\s+text\s+NOT NULL\s+UNIQUE\s+CHECK \(char_length\(nama\) BETWEEN 2 AND 150\)/i);
    expect(instansi).toMatch(/singkatan\s+text\s+CHECK \(char_length\(singkatan\) <= 30\)/i);
    expect(tautan).toMatch(/layanan_id\s+uuid\s+NOT NULL\s+REFERENCES public\.layanan\(id\)\s+ON DELETE CASCADE/i);
    expect(tautan).toMatch(/label\s+text\s+NOT NULL\s+CHECK \(char_length\(label\) BETWEEN 1 AND 80\)/i);
    expect(tautan).toMatch(/url\s+text\s+NOT NULL\s+CHECK \(url ~ '\^https:\/\/\x5cS\+\$' AND char_length\(url\) <= 500\)/i);
    expect(tautan).toMatch(/urut\s+integer\s+NOT NULL DEFAULT 0/i);
    expect(bare).toMatch(/CREATE INDEX IF NOT EXISTS idx_layanan_tautan_layanan_urut\s+ON public\.layanan_tautan \(layanan_id, urut\)/i);
  });

  it('menambah kolom layanan secara aditif', () => {
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS instansi_id uuid REFERENCES public\.instansi\(id\) ON DELETE RESTRICT/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS slug text/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS deskripsi text CHECK \(char_length\(deskripsi\) <= 4000\)/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS urutan integer NOT NULL DEFAULT 100/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS konten_sumber_url text CHECK \(konten_sumber_url ~ '\^https:\/\/\x5cS\+\$' AND char_length\(konten_sumber_url\) <= 500\)/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS konten_diperbarui_at timestamptz/i);
    expect(bare).toMatch(/ADD COLUMN IF NOT EXISTS diarsipkan_at timestamptz/i);
    expect(bare.match(/ADD COLUMN IF NOT EXISTS/gi)).toHaveLength(7);
    expect(bare).toMatch(/slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
  });

  it('mendefinisikan slug_dari_nama dan trigger pengisi slug saat INSERT', () => {
    expect(bare).toMatch(/CREATE OR REPLACE FUNCTION public\.slug_dari_nama\(p_nama text\)\s+RETURNS text\s+LANGUAGE sql\s+IMMUTABLE/i);
    expect(bare).not.toMatch(/unaccent/i);
    expect(bare).toMatch(/COALESCE\(\s*NULLIF\([\s\S]*?'layanan'\s*\)/i);
    expect(bare).toMatch(/CREATE TRIGGER trg_layanan_isi_slug\s+BEFORE INSERT ON public\.layanan/i);
    expect(bare).toMatch(/NEW\.slug IS NULL/i);
  });

  it('mengisi slug hanya untuk baris yang slug-nya NULL lalu menjadikannya NOT NULL dan UNIQUE', () => {
    const updates = bare.match(/UPDATE public\.layanan[\s\S]*?;/gi) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/UPDATE public\.layanan\s+SET slug = [\s\S]*WHERE id = /i);
    expect(updates[0]).not.toMatch(/SET[\s\S]*,\s*\w+\s*=/i);
    expect(bare).toMatch(/WHERE slug IS NULL\s+ORDER BY nama/i);
    expect(bare).toMatch(/ALTER COLUMN slug SET NOT NULL/i);
    expect(bare).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_slug ON public\.layanan \(slug\)/i);
    expect(bare.indexOf('trg_layanan_isi_slug')).toBeLessThan(bare.indexOf('WHERE slug IS NULL'));
    expect(bare.indexOf('WHERE slug IS NULL')).toBeLessThan(bare.indexOf('ALTER COLUMN slug SET NOT NULL'));
  });

  it('tidak destruktif', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|DROP\s+(TABLE|COLUMN)/i);
    expect(bare).not.toMatch(/\bINSERT\s+INTO\s+public\.layanan\b/i);
  });

  it('policy tulis admin memakai TO authenticated, baca publik USING (true)', () => {
    for (const tabel of ['instansi', 'layanan_tautan']) {
      expect(bare).toMatch(new RegExp(String.raw`ALTER TABLE public\.${tabel} ENABLE ROW LEVEL SECURITY`, 'i'));
      expect(bare).toMatch(new RegExp(String.raw`ON public\.${tabel}\s+FOR SELECT USING \(true\)`, 'i'));
      expect(bare).toMatch(
        new RegExp(String.raw`ON public\.${tabel}\s+FOR ALL TO authenticated\s+USING \(public\.get_my_role\(\) = 'admin'\)\s+WITH CHECK \(public\.get_my_role\(\) = 'admin'\)`, 'i'),
      );
      expect(bare).toMatch(new RegExp(String.raw`GRANT SELECT ON TABLE public\.${tabel} TO anon, authenticated`, 'i'));
    }
    expect(bare).not.toMatch(/FOR ALL\s+USING/i);
  });

  it('audit perubahan dipasang', () => {
    expect(bare).toMatch(/CREATE TRIGGER trg_audit_instansi[\s\S]*?ON public\.instansi[\s\S]*?EXECUTE FUNCTION public\.audit_perubahan\(\)/i);
    expect(bare).toMatch(/CREATE TRIGGER trg_audit_layanan_tautan[\s\S]*?ON public\.layanan_tautan[\s\S]*?EXECUTE FUNCTION public\.audit_perubahan\(\)/i);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_audit_instansi ON public\.instansi/i);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_audit_layanan_tautan ON public\.layanan_tautan/i);
  });

  it('mencabut tebakan form dari nama', () => {
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public\.layanan/i);
    expect(bare).not.toMatch(/CREATE TRIGGER trg_layanan_isi_form_pendataan/i);
  });

  it('v_layanan_publik menambah kolom di akhir tanpa mengubah WHERE', () => {
    const view = bare.match(/CREATE OR REPLACE VIEW public\.v_layanan_publik\s+WITH \(security_invoker = true\)\s+AS([\s\S]*?);/i)?.[1];
    expect(view).toBeDefined();
    const lama = ['id', 'nama', 'tipe', 'penyerta', 'status_tampilan', 'punya_antrean', 'punya_chat', 'chatbot_aktif', 'nomor_loket', 'prefiks_antrean'];
    const baru = ['slug', 'deskripsi', 'urutan', 'instansi_nama', 'instansi_singkatan', 'website_terkait'];
    const urutan = [...lama, ...baru].map((kolom) => view!.search(new RegExp(String.raw`(l\.${kolom}\b|AS ${kolom}\b)`)));
    expect(urutan.every((posisi) => posisi >= 0)).toBe(true);
    expect([...urutan].sort((a, b) => a - b)).toEqual(urutan);
    expect(view).toMatch(/website_terkait/);
    expect(view).toMatch(/jsonb_agg\([\s\S]*?ORDER BY t\.urut, t\.created_at/i);
    expect(view).toMatch(/'\[\]'::jsonb/);
    expect(view).toMatch(/WHERE l\.aktif = true AND l\.status_tampilan <> 'nonaktif'/i);
    expect(bare).toMatch(/REVOKE ALL\s+ON public\.v_layanan_publik FROM PUBLIC, anon, authenticated/i);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_layanan_publik TO anon, authenticated/i);
  });

  it('terdaftar di manifest', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(NAMA_FILE);
  });
});
