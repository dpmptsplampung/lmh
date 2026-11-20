// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('supabase/migrations/202611190004_nav_lencana_investasi.sql', 'utf8');
const lama = readFileSync('supabase/migrations/202611110002_nav_lencana.sql', 'utf8');
describe('lencana investasi', () => {
  it('mempertahankan badan terbaru dan menambah pesan baru dengan RLS pemanggil', () => {
    const tambahan = "'pesanInvestasi', CASE WHEN public.boleh_kelola_investasi() THEN\n        (SELECT count(*) FROM public.investasi_lead WHERE status = 'baru') END,\n      ";
    expect(sql.slice(sql.indexOf('CREATE OR REPLACE')).replace(tambahan, '')).toBe(lama.slice(lama.indexOf('CREATE OR REPLACE')));
    expect(sql).toContain(tambahan);
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).not.toMatch(/\b(BEGIN|COMMIT|CREATE TABLE|ALTER TABLE)\b/);
  });
});
