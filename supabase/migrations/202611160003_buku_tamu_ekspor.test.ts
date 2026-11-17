// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = 'supabase/migrations/202611160003_buku_tamu_ekspor.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

describe('kontrak Buku Tamu G6', () => {
  it('aditif, menjaga teks lama, menambah keluar dan FK nullable dengan indeks', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS waktu_keluar timestamptz/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS menemui_petugas_id uuid REFERENCES public.petugas\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*menemui_petugas_id/);
    expect(sql).toContain('waktu_keluar >= waktu_masuk');
    expect(sql).not.toMatch(/DROP (?:TABLE|COLUMN)|TRUNCATE|DELETE FROM/i);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('checkout memakai guard sesi/akun, kunci baris, audit atomik tanpa PII, execute terbatas', () => {
    expect(sql).toContain('public.buku_tamu_catat_keluar(p_id uuid, p_waktu_keluar timestamptz DEFAULT NULL)');
    expect(sql).toContain('public.sesi_valid()');
    expect(sql).toContain('public.staf_lingkup()');
    expect(sql).toContain("v_role NOT IN ('admin', 'front_office')");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('IF v_tamu.waktu_keluar IS NOT NULL THEN');
    expect(sql).toContain('INSERT INTO public.audit_log');
    expect(sql).not.toContain('EXCEPTION WHEN');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.buku_tamu_catat_keluar(uuid, timestamptz) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('SET search_path = pg_catalog, public');
  });
  it('FO boleh baca/tambah dan checkout RPC, tidak mendapat UPDATE umum', () => {
    expect(sql).toContain('CREATE POLICY buku_tamu_staff_select');
    expect(sql).toContain('CREATE POLICY buku_tamu_staff_insert');
    expect(sql).toMatch(/CREATE POLICY buku_tamu_admin_update[\s\S]*?FOR UPDATE/);
    expect(sql).toContain("public.peran_saya() = 'admin'");
  });
});
