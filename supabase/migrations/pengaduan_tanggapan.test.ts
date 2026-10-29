// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030006_pengaduan_tanggapan.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030006_pengaduan_tanggapan', () => {
  it('terdaftar dan tanpa kontrol transaksi', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('tabel tertutup: RLS, hanya admin/front_office membaca, tanpa policy tulis', () => {
    expect(kode).toMatch(/ALTER TABLE public\.pengaduan_tanggapan ENABLE ROW LEVEL SECURITY/);
    expect(kode).toMatch(/ALTER TABLE public\.pengaduan_lampiran ENABLE ROW LEVEL SECURITY/);
    expect(kode).not.toMatch(/ON public\.pengaduan_(tanggapan|lampiran) FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it('tanggapi_pengaduan: hanya staf, FO tidak menyentuh integritas, maks 3 lampiran, kunci terikat ke pengaduan', () => {
    expect(kode).toMatch(/v_me_role NOT IN \('admin', 'front_office'\)/);
    expect(kode).toMatch(/v_me_role = 'front_office' AND v_p\.jalur <> 'layanan'/);
    expect(kode).toContain('jsonb_array_length(p_lampiran) > 3');
    expect(kode).toContain("'^pengaduan-bukti/' || p_pengaduan_id::text");
    expect(kode).toMatch(/REVOKE ALL ON FUNCTION public\.tanggapi_pengaduan\(uuid, text, text, boolean, jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(kode).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.tanggapi_pengaduan[^;]*anon/);
  });
  it('email hanya bila tidak anonim, ada email, bukan impor', () => {
    expect(kode).toContain("v_p.pelapor_email IS NOT NULL AND NOT v_p.anonim AND v_p.sumber <> 'impor'");
  });
  it('pantau publik hanya pengaduan wizard', () => {
    expect((kode.match(/p\.sumber = 'wizard'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
