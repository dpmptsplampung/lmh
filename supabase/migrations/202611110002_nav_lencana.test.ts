// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202611110002_nav_lencana.sql'), 'utf8');
const rollback = readFileSync(join(process.cwd(), 'docs/rollback-nav-lencana-202611110002.sql'), 'utf8');

describe('kontrak statis 202611110002_nav_lencana', () => {
  it('tanda tangan: tanggal + penanda hari tanpa layanan, jsonb, STABLE, SECURITY INVOKER', () => {
    expect(sql).toContain('FUNCTION public.nav_lencana_saya(');
    expect(sql).toContain('p_tanggal date');
    expect(sql).toContain('p_hari_tanpa_layanan boolean DEFAULT false');
    expect(sql).toMatch(/RETURNS jsonb/);
    expect(sql).toMatch(/LANGUAGE sql\s+STABLE\s+SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toContain('SET search_path = pg_catalog, public');
  });

  it('hanya authenticated yang dapat EXECUTE', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.nav_lencana_saya(date, boolean) FROM PUBLIC, anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.nav_lencana_saya(date, boolean) TO authenticated');
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*(anon|PUBLIC)/);
  });

  it('enam kunci lencana dengan predikat yang sama seperti useNavBadges', () => {
    for (const k of ['kotakMasukFo', 'liveChat', 'penangananFo', 'antrian', 'pengaduan', 'saran']) expect(sql).toContain(`'${k}'`);
    expect(sql).toContain("p.saluran <> 'chat'");
    expect(sql).toContain('p.tahap_ke > 1');
    expect(sql).toContain("c.status = 'eskalasi'");
    expect(sql).toContain("t.status IN ('menunggu', 'dipanggil')");
    expect(sql).toContain("g.jalur = 'layanan'");
    expect(sql).toContain('r.ditinjau_pada IS NULL');
    expect(sql).toContain('p.penangan_id = me.id');
    expect(sql).toContain('s.aktif = true');
  });

  it('tidak menulis data dan tidak mengubah objek lain', () => {
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE TABLE|CREATE POLICY)\b/);
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });

  it('rollback hanya menghapus fungsi ini', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.nav_lencana_saya(date, boolean)');
    expect(rollback.match(/DROP/g)).toHaveLength(1);
  });
});
