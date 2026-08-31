// supabase/migrations/pendataan_pelayanan.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202608290001_pendataan_pelayanan.sql'), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

describe('202608290001_pendataan_pelayanan migration', () => {
  it('creates table pelayanan_oss with 3 new optional fields (tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha)', () => {
    expect(bare).toMatch(/CREATE TABLE IF NOT EXISTS public\.pelayanan_oss/i);
    expect(bare).toMatch(/tiket_id\s+uuid\s+NOT NULL\s+UNIQUE\s+REFERENCES\s+public\.tiket_antrean/i);
    expect(bare).toMatch(/nama_pemohon\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/nama_usaha\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/tipe_pelaku_usaha\s+text\s+CHECK/i);
    expect(bare).toMatch(/status_penanaman_modal\s+text\s+CHECK/i);
    expect(bare).toMatch(/lokasi_usaha\s+text/i);
    expect(bare).toMatch(/tindak_lanjut\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/uraian_solusi\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/skala_usaha\s+text\s+CHECK/i);
    expect(bare).toMatch(/is_locked\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  });

  it('creates table pelayanan_perizinan without residues', () => {
    expect(bare).toMatch(/CREATE TABLE IF NOT EXISTS public\.pelayanan_perizinan/i);
    expect(bare).toMatch(/tiket_id\s+uuid\s+NOT NULL\s+UNIQUE\s+REFERENCES\s+public\.tiket_antrean/i);
    expect(bare).toMatch(/nama_pemohon\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/nama_perusahaan\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/opd_teknis\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/uraian_permohonan\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/tindak_lanjut\s+text\s+NOT NULL/i);
    expect(bare).toMatch(/catatan_petugas\s+text/i);
    expect(bare).not.toMatch(/status_berkas/i);
    expect(bare).not.toMatch(/nomor_permohonan/i);
  });

  it('defines the immutability lock trigger function with admin bypass', () => {
    expect(bare).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_enforce_pelayanan_lock\(\)/i);
    expect(bare).toMatch(/IF\s+OLD\.is_locked\s*=\s*true\s+AND\s*\(public\.get_my_role\(\)\s*<>\s*'admin'\)/i);
    expect(bare).toMatch(/CREATE TRIGGER trg_oss_lock\s+BEFORE UPDATE ON public\.pelayanan_oss/i);
    expect(bare).toMatch(/CREATE TRIGGER trg_perizinan_lock\s+BEFORE UPDATE ON public\.pelayanan_perizinan/i);
  });

  it('creates rekapitulasi views including the 3 new optional fields in v_rekap_pelayanan_oss', () => {
    expect(bare).toMatch(/CREATE OR REPLACE VIEW public\.v_rekap_pelayanan_oss\s+WITH\s*\(security_invoker\s*=\s*true\)/i);
    expect(bare).toMatch(/tipe_pelaku_usaha/i);
    expect(bare).toMatch(/status_penanaman_modal/i);
    expect(bare).toMatch(/lokasi_usaha/i);
    expect(bare).toMatch(/CREATE OR REPLACE VIEW public\.v_rekap_pelayanan_perizinan\s+WITH\s*\(security_invoker\s*=\s*true\)/i);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_rekap_pelayanan_oss TO authenticated/i);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_rekap_pelayanan_perizinan TO authenticated/i);
  });

  it('enforces RLS on both tables and grants appropriate permissions', () => {
    expect(bare).toMatch(/ALTER TABLE public\.pelayanan_oss ENABLE ROW LEVEL SECURITY/i);
    expect(bare).toMatch(/ALTER TABLE public\.pelayanan_perizinan ENABLE ROW LEVEL SECURITY/i);
    expect(bare).toMatch(/CREATE POLICY oss_read_staff ON public\.pelayanan_oss/i);
    expect(bare).toMatch(/CREATE POLICY oss_insert_staff ON public\.pelayanan_oss/i);
    expect(bare).toMatch(/CREATE POLICY oss_update_staff ON public\.pelayanan_oss/i);
    expect(bare).toMatch(/CREATE POLICY perizinan_read_staff ON public\.pelayanan_perizinan/i);
    expect(bare).toMatch(/CREATE POLICY perizinan_insert_staff ON public\.pelayanan_perizinan/i);
    expect(bare).toMatch(/CREATE POLICY perizinan_update_staff ON public\.pelayanan_perizinan/i);
  });
});
