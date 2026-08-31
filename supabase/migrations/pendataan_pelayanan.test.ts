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

describe('202608310001_finalize_pelayanan_rpc migration', () => {
  const rpcSql = readFileSync(join(__dirname, '202608310001_finalize_pelayanan_rpc.sql'), 'utf8');
  const rpcBare = rpcSql.replace(/--[^\n]*/g, '');

  it('defines an atomic SECURITY DEFINER rpc finalize_pelayanan', () => {
    expect(rpcBare).toMatch(
      /CREATE OR REPLACE FUNCTION public\.finalize_pelayanan\(\s*p_tiket_id\s+uuid,\s*p_form_type\s+text,\s*p_payload\s+jsonb\s*\)/i
    );
    expect(rpcBare).toMatch(/SECURITY DEFINER/i);
    expect(rpcBare).toMatch(/SET search_path = pg_catalog, public/i);
    expect(rpcBare).toMatch(/RETURNS jsonb/i);
  });

  it('enforces authorization: role check and petugas layanan ownership', () => {
    expect(rpcBare).toMatch(/FORBIDDEN: petugas tidak ditemukan atau tidak aktif/i);
    expect(rpcBare).toMatch(/FORBIDDEN: petugas tidak berwenang atas layanan tiket ini/i);
    expect(rpcBare).toMatch(/v_role = 'admin'\s*OR v_role = 'front_office'\s*OR\s*\(v_role = 'petugas' AND v_staff\.layanan_id = v_tiket\.layanan_id\)/i);
  });

  it('rejects finalize when ticket is not being served (INVALID_STATUS) and respects lock', () => {
    expect(rpcBare).toMatch(/INVALID_STATUS: tiket belum dalam status dilayani/i);
    expect(rpcBare).toMatch(/v_tiket\.status <>\s*'dilayani'/i);
    expect(rpcBare).toMatch(/LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah/i);
  });

  it('sets petugas_id only on INSERT and never on UPDATE (kepemilikan draft tetap)', () => {
    // INSERT menyertakan petugas_id
    expect(rpcBare).toMatch(
      /INSERT INTO public\.pelayanan_oss \([\s\S]*?petugas_id[\s\S]*?\) VALUES/i
    );
    expect(rpcBare).toMatch(
      /INSERT INTO public\.pelayanan_perizinan \([\s\S]*?petugas_id[\s\S]*?\) VALUES/i
    );
    // Blok UPDATE ... SET tidak boleh menyentuh petugas_id
    const ossUpdate = rpcBare.match(/UPDATE public\.pelayanan_oss SET([\s\S]*?)WHERE tiket_id/i);
    const pzUpdate = rpcBare.match(/UPDATE public\.pelayanan_perizinan SET([\s\S]*?)WHERE tiket_id/i);
    expect(ossUpdate).toBeTruthy();
    expect(pzUpdate).toBeTruthy();
    expect(ossUpdate?.[1]).not.toMatch(/petugas_id/);
    expect(pzUpdate?.[1]).not.toMatch(/petugas_id/);
  });

  it('completes visit/tiket status in the same transaction and grants execute only to authenticated', () => {
    expect(rpcBare).toMatch(/UPDATE public\.visit\s+SET status = 'selesai', waktu_selesai = v_now/i);
    expect(rpcBare).toMatch(/UPDATE public\.tiket_antrean\s+SET status = 'selesai', waktu_selesai = v_now/i);
    expect(rpcBare).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_pelayanan\(uuid, text, jsonb\) FROM PUBLIC, anon/i
    );
    expect(rpcBare).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.finalize_pelayanan\(uuid, text, jsonb\) TO authenticated/i
    );
  });
});
