import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(__dirname, '202610010001_non_oss_rename.sql'), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

describe('202610010001_non_oss_rename migration', () => {
  it('renames only the agreed layanan and auth email without destructive SQL', () => {
    expect(bare).toMatch(/UPDATE public\.layanan\s+SET nama = 'Non OSS \(SiCantik Lampung\)'\s+WHERE nama = 'Layanan Perizinan DPMPTSP Provinsi Lampung'/i);
    expect(bare).toMatch(/UPDATE auth\.users\s+SET email = 'nonoss@dpmptsp\.web\.id',[\s\S]*?email_change = '',[\s\S]*?email_change_token_new = '',[\s\S]*?email_change_token_current = '',[\s\S]*?email_change_confirm_status = 0,[\s\S]*?email_change_sent_at = NULL\s+WHERE email = 'perizinan@dpmptsp\.web\.id'/i);
    expect(bare).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/i);
  });

  it('adds nullable lokasi_usaha and exposes it through the invoker-security view', () => {
    expect(bare).toMatch(/ALTER TABLE public\.pelayanan_perizinan\s+ADD COLUMN IF NOT EXISTS lokasi_usaha text/i);
    expect(bare).toMatch(/DROP VIEW IF EXISTS public\.v_rekap_pelayanan_perizinan/i);
    expect(bare).toMatch(/CREATE VIEW public\.v_rekap_pelayanan_perizinan\s+WITH \(security_invoker = true\)/i);
    expect(bare).toMatch(/pz\.lokasi_usaha/i);
    expect(bare).toMatch(/REVOKE ALL ON public\.v_rekap_pelayanan_perizinan FROM PUBLIC, anon, authenticated/i);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_rekap_pelayanan_perizinan TO authenticated/i);
  });

  it('replaces name-based pelayanan read policies with row-correlated layanan IDs', () => {
    const oss = bare.match(/CREATE POLICY oss_read_staff ON public\.pelayanan_oss([\s\S]*?);/i)?.[1];
    const perizinan = bare.match(/CREATE POLICY perizinan_read_staff ON public\.pelayanan_perizinan([\s\S]*?);/i)?.[1];
    expect(bare).toMatch(/DROP POLICY IF EXISTS oss_read_staff ON public\.pelayanan_oss/i);
    expect(bare).toMatch(/DROP POLICY IF EXISTS perizinan_read_staff ON public\.pelayanan_perizinan/i);
    expect(oss).toMatch(/l\.id\s*=\s*\(\s*SELECT layanan_id FROM public\.tiket_antrean\s+WHERE id = pelayanan_oss\.tiket_id\s*\)/i);
    expect(perizinan).toMatch(/l\.id\s*=\s*\(\s*SELECT layanan_id FROM public\.tiket_antrean\s+WHERE id = pelayanan_perizinan\.tiket_id\s*\)/i);
    expect(oss).not.toMatch(/l\.nama|ILIKE/i);
    expect(perizinan).not.toMatch(/l\.nama|ILIKE/i);
  });

  it('allows authenticated audit inserts only for the caller and their database role', () => {
    const policy = bare.match(/CREATE POLICY audit_log_insert_own ON public\.audit_log([\s\S]*?);/i)?.[1];
    expect(bare).toMatch(/GRANT INSERT ON TABLE public\.audit_log TO authenticated/i);
    expect(policy).toMatch(/FOR INSERT TO authenticated/i);
    expect(policy).toMatch(/actor_id\s*=\s*auth\.uid\(\)/i);
    expect(policy).toMatch(/actor_role\s*=\s*public\.get_my_role\(\)/i);
  });

  it('replaces finalize RPC to persist lokasi_usaha for perizinan inserts and updates', () => {
    expect(bare).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_pelayanan\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/i);
    const perizinan = bare.match(/ELSIF p_form_type = 'perizinan' THEN([\s\S]*?)ELSE\s+RAISE EXCEPTION 'INVALID_FORM/i)?.[1];
    expect(perizinan).toBeTruthy();
    expect(perizinan).toMatch(/INSERT INTO public\.pelayanan_perizinan[\s\S]*?lokasi_usaha[\s\S]*?NULLIF\(p_payload->>'lokasi_usaha', ''\)/i);
    expect(perizinan).toMatch(/lokasi_usaha\s+=\s+COALESCE\(NULLIF\(p_payload->>'lokasi_usaha', ''\), lokasi_usaha\)/i);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.finalize_pelayanan\(uuid, text, jsonb\) FROM PUBLIC, anon/i);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.finalize_pelayanan\(uuid, text, jsonb\) TO authenticated/i);
  });
});
