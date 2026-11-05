// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = resolve(__dirname, '202611030014_profil_ubah_nama.sql');

describe('0014 kontrak profil sendiri', () => {
  it('flag aditif, RPC sesi sendiri, nama serta audit atomik; tanpa kontrol transaksi', () => {
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS operator_aktif boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.petugas_ubah_profil(p_patch jsonb)');
    expect(sql).toContain('public.staf_saya()');
    expect(sql).toContain('public.sesi_valid()');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("'nama_lama'");
    expect(sql).toContain("'nama_baru'");
    expect(sql).toContain("'Asia/Jakarta'");
    expect(sql).toContain('INSERT INTO public.audit_log');
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('validasi di server DB, reset verifikasi, tanpa cek unik email atau perubahan login', () => {
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain("k.nama NOT IN ('nama', 'no_hp', 'email_notifikasi', 'operator_default')");
    expect(sql).toContain("jsonb_typeof(kv.value) NOT IN ('string', 'null')");
    expect(sql).toContain('char_length(v_nama) NOT BETWEEN 2 AND 100');
    expect(sql).toContain("~ '[[:cntrl:]]'");
    expect(sql).toContain("~ '^[[:space:]]*[=+@-]'");
    expect(sql).toContain('public.email_nyata(v_email) IS NULL');
    expect(sql).toContain("v_email ~ '\\.internal$'");
    expect(sql).toContain('email_notifikasi_verified_at = CASE WHEN v_email IS DISTINCT FROM p.email_notifikasi');
    expect(sql).toContain('THEN NULL ELSE p.email_notifikasi_verified_at END');
    expect(sql).not.toMatch(/UPDATE\s+auth\.users|UNIQUE\s*\([^)]*email_notifikasi/i);
  });
  it('operator hanya Admin/sesi sah dan audit sekali jika berubah, tanpa menghapus nama operator lama', () => {
    const sql = readFileSync(path, 'utf8');
    const admin = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_atur_operator'));
    expect(admin).toContain("WHERE me.role = 'admin'");
    expect(admin).toContain('public.sesi_valid()');
    expect(admin).toContain('IF v_lama IS DISTINCT FROM p_aktif THEN');
    expect(admin).toContain('FOR UPDATE');
    expect(admin).not.toContain('operator_default =');
    expect(sql).toContain('IF NOT v_me.operator_aktif THEN');
    for (const signature of ['petugas_ubah_profil(jsonb)', 'admin_atur_operator(uuid, boolean)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);
    }
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE|GRANT.*TO.*service_role/i);
  });
  it('rollback manual dapat dipanggil atomik, mengembalikan RPC lama dan mempertahankan data', () => {
    const rollback = readFileSync(resolve(__dirname, '../../docs/rollback-profil-ubah-nama-202611030014.sql'), 'utf8');
    expect(mengandungKontrolTransaksi(rollback)).toBe(false);
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.admin_atur_operator(uuid, boolean)');
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.petugas_ubah_profil(p_patch jsonb)');
    expect(rollback).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE/i);
  });
});
