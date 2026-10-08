// @vitest-environment node
// Kontrak statis migrasi RBAC Tahap 1 (tidak mengeksekusi SQL). Perilaku: scripts/test-rbac-tahap1.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const raw = readFileSync(join(MIGRATIONS_DIR, '202610090001_rbac_tahap1.sql'), 'utf8');
const sql = stripSqlComments(raw);
const rollback = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-rbac-tahap1-202610090001.sql'), 'utf8');

describe('RBAC Tahap 1 migrasi', () => {
  it('atomik: tanpa BEGIN/COMMIT (file maupun rollback)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollback)).toBe(false);
  });

  it('setiap fungsi SECURITY DEFINER mengunci search_path', () => {
    const defs = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)[\s\S]*?\$\$;/gi)];
    expect(defs.length).toBeGreaterThanOrEqual(9);
    for (const d of defs) {
      if (/SECURITY\s+DEFINER/i.test(d[0])) expect(d[0], d[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog/i);
    }
  });

  it('koreksi_pelayanan: Admin/FO aktif, alasan wajib, audit nilai lama/baru, tidak untuk anon', () => {
    const b = sql.match(/FUNCTION public\.koreksi_pelayanan[\s\S]*?\$\$;/i)![0];
    expect(b).toMatch(/staf_saya\(\)/);
    expect(b).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(b).toMatch(/ALASAN_WAJIB/);
    expect(b).toMatch(/INSERT INTO public\.audit_log/);
    expect(b).toMatch(/'lama'[\s\S]*'baru'/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.koreksi_pelayanan\(uuid, text, jsonb, text\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it('data terkunci hanya bisa diubah lewat flag koreksi; INSERT/UPDATE hanya draf (S8)', () => {
    expect(sql).toMatch(/OLD\.is_locked = true AND COALESCE\(pg_catalog\.current_setting\('lmh\.koreksi'/);
    for (const t of ['oss', 'perizinan']) {
      const ins = sql.match(new RegExp(`CREATE POLICY ${t}_insert_staff[\\s\\S]*?;`))![0];
      expect(ins).toMatch(/is_locked = false/);
      expect(ins).toMatch(/status_draft = 'draft'/);
      expect(ins).toMatch(/boleh_tiket\(tiket_id\)/);
      const upd = sql.match(new RegExp(`CREATE POLICY ${t}_update_staff[\\s\\S]*?;`))![0];
      expect(upd).toMatch(/USING \(is_locked = false/);
    }
  });

  it('catat_absensi: tepat satu bentuk (4 argumen), 3-argumen di-DROP', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.catat_absensi\(uuid, text, uuid\);/);
    expect([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.catat_absensi/gi)]).toHaveLength(1);
    expect(sql).toMatch(/p_foto_url\s+text DEFAULT NULL/);
    expect(sql).toMatch(/bucket_id = 'absensi-foto' AND public\.peran_saya\(\) IN \('admin', 'front_office'\)/);
  });

  it('jam tutup: default 16:00 WIB, hanya walk_in, job akhir-hari 09:00 UTC, layanan_hari admin saja', () => {
    expect(sql).toMatch(/VALUES \('jam_tutup_layanan', '16:00'\)/);
    expect(sql).toMatch(/NEW\.asal = 'walk_in' AND public\.layanan_sudah_tutup\(\)/);
    expect(sql).toMatch(/AT TIME ZONE 'Asia\/Jakarta'\)::time >= public\.jam_tutup_layanan\(\)/);
    expect(sql).toMatch(/schedule := '0 9 \* \* \*'/);
    expect(sql).toMatch(/layanan_hari_admin_write[\s\S]*?peran_saya\(\) = 'admin'/);
  });

  it('pengaduan: view petugas tanpa kontak/lampiran; integritas Admin saja', () => {
    const v = sql.match(/VIEW public\.v_pengaduan_petugas[\s\S]*?;/)![0];
    expect(v).not.toMatch(/kontak|lampiran_path|sesi_chat_id/);
    expect(sql).toMatch(/pengaduan_layanan_read[\s\S]*?peran_saya\(\) IN \('admin', 'front_office'\)/);
    expect(sql).toMatch(/pengaduan_integritas_admin_only[\s\S]*?peran_saya\(\) = 'admin'/);
  });

  it('per layanan: investasi_lead admin saja, SKM rinci petugas tanpa visit_id', () => {
    expect(sql).toMatch(/investasi_lead_select_staff[\s\S]*?peran_saya\(\) = 'admin'/);
    expect(sql.match(/VIEW public\.v_skm_petugas[\s\S]*?;/)![0]).not.toMatch(/visit_id/);
    expect(sql).toMatch(/rekap_harian_staff_read[\s\S]*?boleh_layanan\(layanan_id\)/);
  });
});
