// @vitest-environment node
// Kontrak statis migrasi 202610090004 (tidak mengeksekusi SQL). Perilaku: scripts/test-rbac-akhir.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const raw = readFileSync(join(MIGRATIONS_DIR, '202610090004_kelola_layanan_audit.sql'), 'utf8');
const sql = stripSqlComments(raw);
const rollback = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-rbac-akhir-202610090004.sql'), 'utf8');

describe('RBAC akhir: kelola layanan + buku tamu + audit', () => {
  it('atomik: tanpa BEGIN/COMMIT (file maupun rollback)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollback)).toBe(false);
  });

  it('setiap fungsi SECURITY DEFINER mengunci search_path dan dicabut dari pengguna', () => {
    const defs = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)[\s\S]*?\$\$;/gi)];
    expect(defs.map((d) => d[1]).sort()).toEqual(['audit_perubahan', 'audit_saring']);
    for (const d of defs) {
      expect(d[0], d[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog/i);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${d[1]}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
    expect(sql.match(/audit_perubahan\(\)[\s\S]*?SECURITY DEFINER/i)).toBeTruthy();
  });

  it('layar TV: tampil_di_layar default true; v_layar_antrian dan v_layanan_publik menyaringnya', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tampil_di_layar boolean NOT NULL DEFAULT true/);
    const layar = sql.match(/CREATE OR REPLACE VIEW public\.v_layar_antrian[\s\S]*?GROUP BY/i)![0];
    expect(layar).toMatch(/WHERE l\.aktif = true AND l\.tampil_di_layar = true/);
    const publik = sql.match(/CREATE OR REPLACE VIEW public\.v_layanan_publik[\s\S]*?;/i)![0];
    expect(publik).toMatch(/security_invoker = true/);
    expect(publik).toMatch(/status_tampilan <> 'nonaktif'/);
    expect(sql).toMatch(/GRANT SELECT ON public\.v_layanan_publik TO anon, authenticated/);
  });

  it('tidak menyentuh penerbitan tiket / check-in (tanpa kolom tampilan di fungsi tiket)', () => {
    expect(sql).not.toMatch(/terbit_tiket|terbit_nomor_antrean|sync_visit_dual_write|DROP POLICY[^;]*(kunjungan|tiket_antrean|visit)/i);
  });

  it('buku tamu: Admin/FO baca+tambah (dicatat_oleh = diri sendiri), ubah/hapus Admin saja', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS buku_tamu_fo_admin_all/);
    const ins = sql.match(/CREATE POLICY buku_tamu_staff_insert[\s\S]*?;/i)![0];
    expect(ins).toMatch(/get_my_role\(\) IN \('admin', 'front_office'\)/);
    expect(ins).toMatch(/dicatat_oleh IN \(SELECT me\.id FROM public\.staf_saya\(\) AS me\)/);
    expect(sql.match(/CREATE POLICY buku_tamu_admin_update[\s\S]*?;/i)![0]).toMatch(/get_my_role\(\) = 'admin'/);
    expect(sql.match(/CREATE POLICY buku_tamu_admin_delete[\s\S]*?;/i)![0]).toMatch(/get_my_role\(\) = 'admin'/);
  });

  it('audit_log: tulis langsung pengguna dicabut (S14), baca tetap Admin, nilai lama/baru', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS audit_log_insert_own ON public\.audit_log/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.audit_log FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.audit_log TO authenticated/);
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\.audit_log TO authenticated/i);
    expect(sql).toMatch(/nilai_lama jsonb/);
    expect(sql).toMatch(/nilai_baru jsonb/);
  });

  it('trigger audit pada semua tabel yang diminta; token layar/embedding tidak dicatat', () => {
    for (const t of ['layanan', 'layanan_jadwal', 'layanan_libur', 'site_settings', 'landing_content', 'faq_knowledge_base', 'layar_token']) {
      expect(sql, t).toMatch(new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON public\\.${t}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.audit_perubahan`));
    }
    expect(sql).toMatch(/AFTER UPDATE OF role, aktif, username, layanan_id, nama ON public\.petugas/);
    const layar = sql.match(/CREATE TRIGGER trg_audit_layar_token[\s\S]*?;/i)![0];
    expect(layar).not.toMatch(/'token'/);
    expect(sql).toMatch(/NOT IN \('embedding', 'token', 'token_hash', 'password'/);
    expect(sql).toMatch(/\(secret\|token\|password/);
  });

  it('rollback memulihkan view lama sebelum menghapus kolom dan mengembalikan trigger role', () => {
    expect(rollback.indexOf('CREATE OR REPLACE VIEW public.v_layar_antrian')).toBeLessThan(
      rollback.indexOf('DROP COLUMN IF EXISTS tampil_di_layar'),
    );
    expect(rollback).toMatch(/CREATE TRIGGER trg_audit_petugas_role AFTER UPDATE OF role/);
    expect(rollback).toMatch(/CREATE POLICY audit_log_insert_own/);
  });
});

const sql5 = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, '202610090005_perbaikan_review.sql'), 'utf8'));
const raw5 = readFileSync(join(MIGRATIONS_DIR, '202610090005_perbaikan_review.sql'), 'utf8');
const rb5 = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-rbac-akhir-202610090005.sql'), 'utf8');

describe('perbaikan review 0005', () => {
  it('atomik dan rollback berurutan', () => {
    expect(mengandungKontrolTransaksi(raw5)).toBe(false);
    expect(mengandungKontrolTransaksi(rb5)).toBe(false);
    expect(rb5).toMatch(/0005 -> 0004 -> 0003 -> 0002 -> 0001/);
  });
  it('FO baca petugas (SELECT saja), host rahasia, penjaga hapus admin, kunci jam tutup', () => {
    const pol = sql5.match(/CREATE POLICY petugas_fo_read[\s\S]*?;/i)![0];
    expect(pol).toMatch(/FOR SELECT/);
    expect(pol).toMatch(/get_my_role\(\) = 'front_office'/);
    expect(sql5).toMatch(/ADD COLUMN IF NOT EXISTS host text/);
    expect(sql5).toMatch(/AFTER DELETE ON public\.petugas\s+FOR EACH ROW/);
    expect(sql5).toMatch(/jam_tutup_layanan'\s+AND NEW\.value IS DISTINCT FROM '16:00'/);
    const defs = [...sql5.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)[\s\S]*?\$\$;/gi)];
    for (const d of defs) if (/SECURITY\s+DEFINER/i.test(d[0])) expect(d[0], d[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog/i);
  });
});
