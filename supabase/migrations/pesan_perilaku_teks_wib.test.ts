// @vitest-environment node
// Kontrak statis 202611030001: teks notifikasi "Pesan Perilaku" dan hitung_ikm berbasis tanggal WIB.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migration-test-utils';

const sql = readFileSync(join(MIGRATIONS_DIR, '202611030001_pesan_perilaku_teks_wib.sql'), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030001_pesan_perilaku_teks_wib', () => {
  it('notifikasi menyebut Pesan Perilaku dan tidak lagi SKM', () => {
    expect(kode).toContain("'Pesan Perilaku - DPMPTSP Lampung'");
    expect(kode).toContain("'Layanan Selesai - Isi Pesan Perilaku'");
    expect(kode).not.toMatch(/Survei SKM|Survei Kepuasan Masyarakat/);
  });
  it('tautan undangan dan jenis notifikasi tidak berubah', () => {
    expect(kode).toContain("'/survei/' || v_token");
    expect(kode).toContain("'skm_survey'");
    expect(kode).toContain("'skm_survey_push'");
  });
  it('hitung_ikm memakai tanggal WIB dan hak anon tetap', () => {
    expect(kode).toContain("(response.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end");
    expect(kode).toMatch(/GRANT EXECUTE ON FUNCTION public\.hitung_ikm\(uuid, date, date\) TO anon, authenticated/);
  });
  it('tanpa DROP/TRUNCATE dan tanpa kontrol transaksi', () => {
    expect(kode).not.toMatch(/\b(DROP|TRUNCATE|BEGIN;|COMMIT)\b/i);
  });
});
