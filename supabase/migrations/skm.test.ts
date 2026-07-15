// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final SKM baseline', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);

  it('creates the nine-element response table with one response per visit', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.skm_respons/i);
    for (const column of ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan']) {
      expect(feature).toMatch(new RegExp(`${column}\\s+smallint\\s+CHECK`, 'i'));
    }
    expect(feature).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+skm_respons_visit_id_uniq/i);
  });

  it('enforces all rating ranges and computes the dated nine-element IKM formula', () => {
    for (const column of ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan']) {
      expect(feature).toMatch(new RegExp(`${column}\\s+smallint\\s+CHECK\\s*\\(${column}\\s+BETWEEN\\s+1\\s+AND\\s+4\\)`, 'i'));
    }
    expect(security).toMatch(/response\.u1_persyaratan\s*\+[\s\S]*response\.u9_pengaduan\)\s*\/\s*9\.0[\s\S]*\*\s*25\s+AS\s+ikm/i);
    expect(security).toMatch(/response\.layanan_id\s*=\s*p_layanan_id/i);
    expect(security).toMatch(/response\.created_at::date\s+BETWEEN\s+p_start\s+AND\s+p_end/i);
    expect(feature).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+skm_respons_visit_id_uniq[\s\S]*WHERE\s+visit_id\s+IS\s+NOT\s+NULL/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"skm_select_staff"[\s\S]*layanan_id\s*=\s*public\.get_my_layanan_id\(\)[\s\S]*public\.get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('keeps public IKM aggregation explicit and deny-by-default', () => {
    expect(security).toMatch(/FUNCTION\s+public\.hitung_ikm/i);
    expect(security).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.hitung_ikm[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(security).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.hitung_ikm[\s\S]*TO\s+anon,\s*authenticated/i);
  });

  it('provides a minimal anonymous token context without visit IDs or PII', () => {
    const fn = security.match(/CREATE\s+FUNCTION\s+public\.get_skm_context[\s\S]*?REVOKE\s+EXECUTE[^;]+;/i)?.[0] ?? '';
    expect(fn).toMatch(/p_token\s+text/i);
    expect(fn).toMatch(/RETURNS\s+TABLE\s*\(\s*eligible\s+boolean,\s*already_submitted\s+boolean,\s*layanan_nama\s+text\s*\)/i);
    expect(fn).toMatch(/visit\.qr_token\s*=\s*p_token/i);
    expect(fn).toMatch(/visit\.status\s*=\s*'selesai'/i);
    const returnShape = fn.match(/RETURNS\s+TABLE\s*\([^)]*\)/i)?.[0] ?? '';
    expect(returnShape).not.toMatch(/\b(?:visit_id|layanan_id|email|nama_pengunjung)\b/i);
    expect(security).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_skm_context\(text\)\s+TO\s+anon,\s*authenticated/i);
  });

  it('submits atomically by token and derives trusted IDs from the completed visit', () => {
    const fn = security.match(/CREATE\s+FUNCTION\s+public\.submit_skm_response[\s\S]*?REVOKE\s+EXECUTE[^;]+;/i)?.[0] ?? '';
    expect(fn).toMatch(/SELECT\s+visit\.id,\s*visit\.layanan_id[\s\S]*WHERE\s+visit\.qr_token\s*=\s*p_token[\s\S]*visit\.status\s*=\s*'selesai'/i);
    expect(fn).toMatch(/INSERT\s+INTO\s+public\.skm_respons\s*\(\s*visit_id,\s*layanan_id/i);
    expect(fn).toMatch(/VALUES\s*\(\s*trusted_visit_id,\s*trusted_layanan_id/i);
    expect(fn).toMatch(/unique_violation[\s\S]*duplicate/i);
    expect(security).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.submit_skm_response[\s\S]*TO\s+anon,\s*authenticated/i);
    expect(security).not.toMatch(/CREATE\s+POLICY\s+"skm_insert"/i);
  });
});
