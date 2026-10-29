// @vitest-environment node
// Kontrak statis 202611030008_pesan_perilaku_publik: sapaan (nama di konteks), saran publik, pengaduan publik anonim sungguhan,
// pelacakan nomor untuk sumber 'publik'. Tidak mengeksekusi SQL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const baca = (...p: string[]) => readFileSync(join(MIGRATIONS_DIR, ...p), 'utf8').replace(/\r\n/g, '\n');
const sql = stripSqlComments(baca('202611030008_pesan_perilaku_publik.sql'));
const fungsi = (nama: string) => {
  const mulai = sql.indexOf(`FUNCTION public.${nama}(`);
  expect(mulai, `fungsi ${nama} ada`).toBeGreaterThan(-1);
  const akhir = sql.indexOf('GRANT EXECUTE', mulai);
  return sql.slice(mulai, akhir);
};

describe('202611030008 pesan perilaku publik', () => {
  it('tanpa kontrol transaksi dan dengan penjaga prasyarat', () => {
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(sql).toMatch(/PRASYARAT: tabel saran\/pengaduan/);
    expect(sql).toMatch(/PRASYARAT: fungsi tanggapan pengaduan/);
  });

  it('get_survei_context menambah nama, hanya untuk undangan yang masih bisa diisi, tanpa HP/email', () => {
    const f = fungsi('get_survei_context');
    expect(f).toContain("'nama'");
    expect(f).toMatch(/IF v_status = 'ok' THEN[\s\S]*FROM public\.kunjungan/);
    expect(f).not.toMatch(/hp|email|token'/i);
    for (const kunci of ['status', 'unit', 'layanan_nama', 'kedaluwarsa_pada']) expect(f).toContain(`'${kunci}'`);
  });

  it('saran: sumber publik diizinkan; RPC publik tanpa kaitan kunjungan/undangan', () => {
    expect(sql).toMatch(/saran_sumber_check CHECK \(sumber IN \('wizard', 'impor', 'publik'\)\)/);
    const f = fungsi('kirim_saran_publik');
    expect(f).toMatch(/VALUES \(v_isi, NULL, 'tidak_diketahui', NULL, NULL, v_nama, 'publik'\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.kirim_saran_publik\(text, text\) TO anon, authenticated/);
  });

  it('pengaduan publik: nomor laporan acak, kontak dibuang bila anonim, sumber publik', () => {
    const f = fungsi('kirim_pengaduan_publik');
    expect(f).toContain('public.generate_nomor_laporan()');
    expect(f).toMatch(/IF p_anonim THEN\s+v_kontak := NULL;/);
    expect(f).toMatch(/'publik'/);
    expect(f).toMatch(/jalur tidak valid/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.kirim_pengaduan_publik\(text, text, uuid, boolean, text\) TO anon, authenticated/);
    // Pengaduan anonim tidak menyimpan identitas sama sekali.
    expect(f).not.toMatch(/kunjungan_id|pelapor_nama|pelapor_email|sesi_chat_id/);
  });

  it.each(['lacak_pengaduan_nomor', 'tanggapan_pengaduan_nomor', 'lampiran_pengaduan_nomor'])(
    '%s melayani sumber wizard dan publik',
    (nama) => {
      expect(fungsi(nama)).toContain("p.sumber IN ('wizard', 'publik')");
    },
  );

  it('semua fungsi baru: SECURITY DEFINER, search_path terkunci, hak anon eksplisit', () => {
    for (const nama of ['get_survei_context', 'kirim_saran_publik', 'kirim_pengaduan_publik', 'lacak_pengaduan_nomor']) {
      const f = fungsi(nama);
      expect(f).toContain('SECURITY DEFINER');
      expect(f).toContain('SET search_path = pg_catalog, public');
    }
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.kirim_saran_publik\(text, text\) FROM PUBLIC, anon, authenticated/);
  });

  it('rollback ada dan menolak bila masih ada data publik', () => {
    const rb = readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', 'rollback-pesan-perilaku-publik-202611030008.sql'), 'utf8');
    expect(rb).toMatch(/PRASYARAT ROLLBACK/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.kirim_saran_publik/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.kirim_pengaduan_publik/);
  });
});
