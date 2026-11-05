// @vitest-environment node
// Kontrak statis saja: tidak membuka koneksi DB dan tidak membuktikan evaluasi RLS di staging.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030009_chat_identitas_google.sql';
const bacaSql = () => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8'));

describe('R1 — kontrak gerbang identitas chat pada database', () => {
  it('pengunjung Google nonanonim dan staf aktif lolos; identitas kosong, anonim, serta staf nonaktif ditolak', () => {
    const sql = bacaSql();
    const helper = sql.match(/CREATE OR REPLACE FUNCTION public\.chat_identitas_diizinkan\(\)[\s\S]*?END \$\$;/i)?.[0];
    expect(helper).toBeDefined();
    expect(helper).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/i);
    expect(helper).toMatch(/IF v_uid IS NULL THEN\s+RETURN false;/i);
    expect(helper).toMatch(/FROM auth\.users AS u[\s\S]*u\.id = v_uid[\s\S]*u\.is_anonymous IS FALSE/i);
    expect(helper).toMatch(/IF NOT FOUND THEN\s+RETURN false;/i);
    expect(helper).toMatch(/FROM public\.petugas AS p[\s\S]*p\.auth_user_id = v_uid AND p\.aktif = false[\s\S]*RETURN false;/i);
    expect(helper).toMatch(/IF public\.get_my_role\(\) IN \('admin', 'petugas', 'front_office'\) THEN\s+RETURN true;/i);
    expect(helper).toMatch(/RETURN COALESCE\(\s*EXISTS\s*\([\s\S]*FROM auth\.identities AS i[\s\S]*i\.user_id = v_uid AND i\.provider = 'google'/i);
    expect(helper).toMatch(/OR v_meta ->> 'provider' = 'google'/i);
    expect(helper).toMatch(/jsonb_typeof\(v_meta -> 'providers'\) = 'array'[\s\S]*v_meta -> 'providers' @> '\["google"\]'::jsonb/i);
    expect(helper?.indexOf('u.is_anonymous IS FALSE')).toBeLessThan(helper?.indexOf('IF public.get_my_role()') ?? -1);
    expect(helper?.indexOf('p.aktif = false')).toBeLessThan(helper?.indexOf('IF public.get_my_role()') ?? -1);
    expect(helper).toMatch(/false\s*\);\s+END \$\$;/i);
    expect(helper).not.toMatch(/user_metadata|raw_user_meta_data|pengunjung\.provider|current_user/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.chat_identitas_diizinkan\(\) FROM PUBLIC, anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_identitas_diizinkan\(\) TO authenticated, service_role;/i);
  });

  it('menambah syarat AND pada INSERT langsung tanpa melonggarkan ownership, pengirim, scope, atau rate limit lama', () => {
    const sql = bacaSql();
    for (const tabel of ['chat_sesi', 'chat_pesan']) {
      expect(sql).toContain(`CREATE POLICY "${tabel}_identitas_insert" ON public.${tabel}`);
    }
    expect(sql.match(/AS RESTRICTIVE FOR INSERT TO authenticated\s+WITH CHECK \(\(SELECT public\.chat_identitas_diizinkan\(\)\)\);/gi)).toHaveLength(2);
    expect(sql).not.toMatch(/DROP POLICY[^;]*owner_insert|CREATE POLICY[^;]*AS PERMISSIVE/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.chat_sesi_jaga_rpc/);
  });

  it('INSERT lewat SECURITY DEFINER tetap diperiksa, termasuk pesan bot dari RPC pengunjung', () => {
    const sql = bacaSql();
    for (const tabel of ['chat_sesi', 'chat_pesan']) {
      expect(sql).toContain(`CREATE TRIGGER trg_${tabel}_identitas_insert`);
      expect(sql).toContain(`BEFORE INSERT ON public.${tabel}`);
    }
    expect(sql.match(/FOR EACH ROW EXECUTE FUNCTION public\.chat_jaga_identitas_insert\(\);/gi)).toHaveLength(2);
    const guard = sql.match(/CREATE OR REPLACE FUNCTION public\.chat_jaga_identitas_insert\(\)[\s\S]*?END \$\$;/i)?.[0];
    expect(guard).toBeDefined();
    expect(guard).toMatch(/IF NOT public\.chat_identitas_diizinkan\(\) THEN\s+RAISE EXCEPTION 'LOGIN_GOOGLE:[^']*' USING ERRCODE = '42501';/i);
    // Pengirim 'bot', SECURITY DEFINER, dan flag RPC tidak membuktikan identitas pemanggil.
    expect(guard).not.toMatch(/lmh\.chat_rpc|NEW\.pengirim|current_user|pg_trigger_depth/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.chat_jaga_identitas_insert\(\) FROM PUBLIC, anon, authenticated, service_role;/i);
  });

  it('bot service_role dan cron postgres tanpa JWT tetap lolos; JWT pengguna tidak mendapat pengecualian cron', () => {
    const sql = bacaSql();
    const guard = sql.match(/CREATE OR REPLACE FUNCTION public\.chat_jaga_identitas_insert\(\)[\s\S]*?END \$\$;/i)?.[0];
    expect(guard).toMatch(/IF auth\.jwt\(\) ->> 'role' = 'service_role' THEN\s+RETURN NEW;/i);
    expect(guard).toMatch(/IF SESSION_USER IN \('postgres', 'supabase_admin'\)\s+AND auth\.uid\(\) IS NULL\s+AND COALESCE\(auth\.jwt\(\) ->> 'role', ''\) = '' THEN\s+RETURN NEW;/i);
    expect(guard?.indexOf("'service_role'")).toBeLessThan(guard?.indexOf('IF NOT public.chat_identitas_diizinkan()') ?? -1);
    expect(guard).toMatch(/END IF;\s+RETURN NEW;\s+END \$\$;/i);
  });

  it('migrasi maju tanpa mutasi data atau kontrol transaksi; helper Auth dibatasi dan search_path dikunci', () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
    const sql = bacaSql();
    // Migrasi ini harus lebih baru dari semua yang ada saat ditulis (sampai 0008); migrasi sesudahnya boleh ada.
    const sebelumnya = listMigrationFiles().filter((nama) => nama < BERKAS);
    expect(sebelumnya.length).toBeGreaterThan(0);
    expect(sebelumnya).toContain('202611030008_pesan_perilaku_publik.sql');
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(sql).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|UPDATE public|INSERT INTO|DROP TABLE|DROP SCHEMA|ALTER TABLE)\b/i);
    expect(sql.match(/SET search_path = pg_catalog, public/gi)).toHaveLength(2);
    expect(sql).toMatch(/chat_identitas_diizinkan\(\)\s+RETURNS boolean\s+LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/i);
    expect(sql).toMatch(/chat_jaga_identitas_insert\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY INVOKER/i);
    expect(raw).toContain('terapkan hanya setelah staging lolos');
  });

  it('rollback manual hanya melepas objek baru, tanpa mengubah policy lama atau data percakapan', () => {
    const rollback = stripSqlComments(readFileSync(join(process.cwd(), 'docs/rollback-chat-identitas-google-202611030009.sql'), 'utf8'));
    for (const tabel of ['chat_sesi', 'chat_pesan']) {
      expect(rollback).toContain(`DROP TRIGGER IF EXISTS trg_${tabel}_identitas_insert ON public.${tabel};`);
      expect(rollback).toContain(`DROP POLICY IF EXISTS "${tabel}_identitas_insert" ON public.${tabel};`);
    }
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.chat_jaga_identitas_insert();');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.chat_identitas_diizinkan();');
    expect(rollback).not.toMatch(/CASCADE|owner_insert|chat_sesi_jaga_rpc|DELETE|TRUNCATE|UPDATE|INSERT INTO|DROP TABLE|DROP SCHEMA/i);
    expect(rollback.indexOf('DROP TRIGGER')).toBeLessThan(rollback.indexOf('DROP FUNCTION'));
    expect(rollback.indexOf('DROP POLICY')).toBeLessThan(rollback.indexOf('DROP FUNCTION'));
  });
});
