// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

// 202611030011 = lanjutan hotfix 0010: bagian yang butuh 0006 (pelapor_email, email
// "diterima"), 0008 (kirim_saran_publik/kirim_pengaduan_publik), dan 202611010003 (email_nyata).
const BERKAS = '202611030011_anonimitas_lanjutan.sql';
const ROLLBACK = '../../docs/rollback-anonimitas-lanjutan-202611030011.sql';

function baca(relatif: string) {
  return readFileSync(join(MIGRATIONS_DIR, relatif), 'utf8');
}

function kode(sql: string) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

function fungsi(sql: string, nama: string) {
  const definisi = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;`, 'i'));
  expect(definisi, `definisi ${nama}`).not.toBeNull();
  return definisi![0];
}

describe('202611030011 lanjutan anonimitas', () => {
  const sql = baca(BERKAS);
  const k = kode(sql);

  it('PRASYARAT mensyaratkan 0010, 0006, 0008, dan 202611010003', () => {
    const prasyarat = sql.slice(0, sql.indexOf('ALTER TABLE'));
    for (const rpc of [
      'public.jaga_saran_anonim()',
      'public.jaga_pengaduan_anonim()',
      'public.email_nyata(text)',
      'public.queue_notifikasi(uuid, text, text, text, text, jsonb)',
      'public.kirim_saran_publik(text, text)',
      'public.kirim_pengaduan_publik(text, text, uuid, boolean, text)',
      'public.kirim_pengaduan_survei(text, text, boolean)',
      'public.generate_nomor_laporan()',
      'public.tambah_hari_kerja(date, integer)',
    ]) {
      expect(prasyarat).toContain(`to_regprocedure('${rpc}')`);
    }
    for (const kolom of ['saran.anonim', 'pengaduan.pelapor_email', 'site_settings.value']) {
      expect(prasyarat).toContain(`'${kolom}'`);
    }
    expect(prasyarat).toMatch(/RAISE EXCEPTION 'PRASYARAT:/);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('pembersihan permanen terpisah: saran publik tanpa nama ditandai anonim dan waktunya dibulatkan, trigger dimatikan hanya selama UPDATE itu', () => {
    expect(sql).toContain('PERINGATAN: PEMBERSIHAN PERMANEN');
    expect(sql).toContain('TIDAK BISA DIBATALKAN');
    expect(sql).toMatch(/DIAGNOSTIK SEBELUM[\s\S]*?DIAGNOSTIK SESUDAH/);
    const mati = k.indexOf('ALTER TABLE public.saran DISABLE TRIGGER trg_saran_anonim;');
    const ubah = k.search(/UPDATE public\.saran\s+SET anonim = true/);
    const hidup = k.indexOf('ALTER TABLE public.saran ENABLE TRIGGER trg_saran_anonim;');
    expect(mati).toBeGreaterThan(0);
    expect(ubah).toBeGreaterThan(mati);
    expect(hidup).toBeGreaterThan(ubah);
    const stmt = k.slice(ubah, k.indexOf(';', ubah));
    expect(stmt).toMatch(/sumber = 'publik'/);
    expect(stmt).toMatch(/pelapor_nama IS NULL/);
    expect(stmt).toMatch(/date_trunc\('day', created_at AT TIME ZONE 'Asia\/Jakarta'\) AT TIME ZONE 'Asia\/Jakarta'/);
    expect(k).toMatch(/UPDATE public\.pengaduan SET pelapor_email = NULL WHERE anonim AND pelapor_email IS NOT NULL;/);
    expect(k).not.toMatch(/DELETE FROM|TRUNCATE|DISABLE TRIGGER trg_pengaduan_anonim/);
  });

  it('CHECK pengaduan kini juga mewajibkan pelapor_email NULL untuk anonim (NOT VALID lalu VALIDATE)', () => {
    const cek = k.match(/ADD CONSTRAINT pengaduan_anonim_tanpa_identitas CHECK \(([\s\S]*?)\) NOT VALID;/);
    expect(cek).not.toBeNull();
    for (const c of ['undangan_id', 'kunjungan_id', 'sesi_chat_id', 'kontak', 'pelapor_nama', 'pelapor_email']) {
      expect(cek![1]).toContain(`${c} IS NULL`);
    }
    expect(k).toContain('ALTER TABLE public.pengaduan VALIDATE CONSTRAINT pengaduan_anonim_tanpa_identitas;');
  });

  it('kirim_pengaduan_survei final: email hanya untuk non-anonim, tanpa undangan_id untuk anonim, dedup lewat flag', () => {
    const rpc = fungsi(sql, 'kirim_pengaduan_survei');
    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toMatch(/IF NOT p_anonim THEN\s+SELECT[\s\S]*?public\.email_nyata\(k\.email\)[\s\S]*?FROM public\.kunjungan/);
    for (const kolom of ['v_u.kunjungan_id', "NULLIF(v_nama, '')", 'v_email', 'v_u.id']) {
      expect(rpc).toContain(`CASE WHEN p_anonim THEN NULL ELSE ${kolom} END`);
    }
    expect(rpc).toMatch(/IF NOT p_anonim AND v_email IS NOT NULL THEN[\s\S]*?PERFORM public\.queue_notifikasi\([\s\S]*?END IF;/);
    expect(rpc).not.toMatch(/FROM public\.pengaduan\b/);
    const kunci = rpc.indexOf('WHERE u.token = p_token FOR UPDATE;');
    const dedup = rpc.indexOf('IF v_u.pengaduan_dikirim THEN RETURN');
    const insert = rpc.indexOf('INSERT INTO public.pengaduan (');
    const tandai = rpc.indexOf('UPDATE public.survei_undangan SET pengaduan_dikirim = true WHERE id = v_u.id;');
    expect(kunci).toBeGreaterThan(0);
    expect(dedup).toBeGreaterThan(kunci);
    expect(insert).toBeGreaterThan(dedup);
    expect(tandai).toBeGreaterThan(insert);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;');
  });

  it('kirim_saran_publik menandai nama kosong sebagai anonim; API tetap', () => {
    const rpc = fungsi(sql, 'kirim_saran_publik');
    expect(rpc).toContain('p_isi text, p_nama text DEFAULT NULL');
    expect(rpc).toContain("v_nama, 'publik', v_nama IS NULL");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO anon, authenticated;');
  });

  it('P2-3: kirim_pengaduan_publik hanya service_role; SKM/SPAK dan policy tidak disentuh', () => {
    expect(k).toContain('REVOKE ALL ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;');
    expect(k).toContain('GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) TO service_role;');
    expect(k).not.toMatch(/(?:ALTER|UPDATE|INSERT INTO|DELETE FROM)\s+public\.(?:skm_respons|spak_respons)/i);
    expect(k).not.toMatch(/CREATE POLICY|GRANT (?:SELECT|INSERT|UPDATE)|INSERT INTO public\.(?:audit_log|error_log)/i);
  });
});

describe('rollback 202611030011', () => {
  const rb = baca(ROLLBACK);
  const k = kode(rb);

  it('tanpa BEGIN/COMMIT, memulihkan versi 0006/0008 dan CHECK versi 0010', () => {
    expect(mengandungKontrolTransaksi(rb)).toBe(false);
    const survei = fungsi(rb, 'kirim_pengaduan_survei');
    expect(survei).toContain('public.email_nyata(k.email)');
    expect(fungsi(rb, 'kirim_saran_publik')).toContain("VALUES (v_isi, NULL, 'tidak_diketahui', NULL, NULL, v_nama, 'publik');");
    const cek = k.match(/ADD CONSTRAINT pengaduan_anonim_tanpa_identitas CHECK \(([\s\S]*?)\) NOT VALID;/);
    expect(cek).not.toBeNull();
    expect(cek![1]).not.toContain('pelapor_email');
    expect(k).toContain('GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) TO anon, authenticated;');
    expect(k).not.toMatch(/UPDATE public\.(saran|pengaduan)|DELETE FROM|TRUNCATE|DROP TABLE|DROP TRIGGER/);
    expect(rb).toContain('TIDAK BISA DIBATALKAN');
  });
});
