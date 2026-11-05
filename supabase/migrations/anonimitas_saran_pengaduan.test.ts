// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

// 202611030010 = HOTFIX: hanya memakai objek yang sudah ada di produksi
// (202607290007 pengaduan, 202611020001 survei_undangan, 202611030003 saran/RPC).
// Bagian yang bergantung pada 0006/0008/202611010003 ada di 202611030011.
const BERKAS = '202611030010_anonimitas_saran_pengaduan.sql';
const ROLLBACK = '../../docs/rollback-anonimitas-saran-pengaduan-202611030010.sql';

function baca(relatif: string) {
  return readFileSync(join(MIGRATIONS_DIR, relatif), 'utf8');
}

/** Buang komentar baris agar pola tidak cocok dengan teks penjelasan. */
function kode(sql: string) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

function fungsi(sql: string, nama: string) {
  const definisi = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;`, 'i'));
  expect(definisi, `definisi ${nama}`).not.toBeNull();
  return definisi![0];
}

const HARI_WIB = /date_trunc\('day', [^)]*AT TIME ZONE 'Asia\/Jakarta'\) AT TIME ZONE 'Asia\/Jakarta'/;

describe('202611030010 hotfix anonimitas saran dan pengaduan', () => {
  const sql = baca(BERKAS);
  const k = kode(sql);

  it('PRASYARAT memeriksa semua tabel, kolom, dan fungsi yang dipakai, dan tidak memakai objek migrasi yang belum diterapkan', () => {
    const prasyarat = sql.slice(0, sql.indexOf('ALTER TABLE'));
    for (const tabel of ['saran', 'pengaduan', 'pengaduan_riwayat', 'survei_undangan', 'kunjungan']) {
      expect(prasyarat).toContain(`'${tabel}'`);
    }
    for (const kolom of [
      'saran.undangan_id', 'saran.kunjungan_id', 'saran.pelapor_nama', 'saran.sumber', 'saran.created_at',
      'pengaduan.undangan_id', 'pengaduan.kunjungan_id', 'pengaduan.sesi_chat_id', 'pengaduan.kontak',
      'pengaduan.pelapor_nama', 'pengaduan.anonim', 'pengaduan.sumber', 'pengaduan.created_at', 'pengaduan.updated_at',
      'pengaduan_riwayat.pengaduan_id', 'pengaduan_riwayat.status_lama', 'pengaduan_riwayat.created_at',
      'survei_undangan.saran_dikirim', 'survei_undangan.pengaduan_dikirim',
    ]) {
      expect(prasyarat).toContain(`'${kolom}'`);
    }
    for (const rpc of [
      'public.kirim_saran(text, text, boolean)',
      'public.kirim_pengaduan_survei(text, text, boolean)',
      'public.generate_nomor_laporan()',
      'public.tambah_hari_kerja(date, integer)',
      'public.buat_pengaduan(text, text, text, uuid, boolean, uuid)',
    ]) {
      expect(prasyarat).toContain(`to_regprocedure('${rpc}')`);
    }
    expect(prasyarat).toMatch(/RAISE EXCEPTION 'PRASYARAT:/);
    // Objek 0006/0008/202611010003 tidak boleh dirujuk langsung oleh kode hotfix.
    expect(k).not.toMatch(/email_nyata|queue_notifikasi|kirim_saran_publik|kirim_pengaduan_publik/);
    expect(k).not.toMatch(/NEW\.pelapor_email|pelapor_email\s*(=|IS)/);
  });

  it('pembersihan permanen ada di blok PERINGATAN terpisah dengan diagnostik sebelum dan sesudah, dan berjalan SEBELUM trigger dibuat', () => {
    expect(sql).toContain('PERINGATAN: PEMBERSIHAN PERMANEN');
    expect(sql).toContain('TIDAK BISA DIBATALKAN');
    expect(sql).toMatch(/DIAGNOSTIK SEBELUM[\s\S]*?DIAGNOSTIK SESUDAH/);
    // P1-2: saran anonim lama terdeteksi tepat lewat jejak 0003.
    const saranLama = k.match(/UPDATE public\.saran\s+SET anonim = true[\s\S]*?;/);
    expect(saranLama).not.toBeNull();
    expect(saranLama![0]).toMatch(/sumber = 'wizard'/);
    expect(saranLama![0]).toMatch(/undangan_id IS NOT NULL/);
    expect(saranLama![0]).toMatch(/kunjungan_id IS NULL/);
    for (const kolom of ['undangan_id', 'kunjungan_id', 'pelapor_nama']) expect(saranLama![0]).toContain(`${kolom} = NULL`);
    expect(saranLama![0]).toMatch(HARI_WIB);
    // Pengaduan anonim lama: identitas dikosongkan + waktu dibulatkan; updated_at hanya bila belum pernah diubah staf.
    const pengaduanLama = k.match(/UPDATE public\.pengaduan\s+SET undangan_id = NULL[\s\S]*?;/);
    expect(pengaduanLama).not.toBeNull();
    expect(pengaduanLama![0]).toMatch(/WHERE anonim = true/);
    expect(pengaduanLama![0]).toMatch(HARI_WIB);
    expect(pengaduanLama![0]).toMatch(/updated_at = CASE WHEN updated_at = created_at/);
    // Riwayat awal mengikuti waktu pengaduan yang sudah dibulatkan.
    expect(k).toMatch(/UPDATE public\.pengaduan_riwayat AS r\s+SET created_at = p\.created_at[\s\S]*?p\.anonim[\s\S]*?r\.status_lama IS NULL/);
    // Urutan: pembersihan sebelum trigger (trigger menolak perubahan penanda anonim).
    expect(k.indexOf('UPDATE public.saran')).toBeLessThan(k.indexOf('CREATE TRIGGER trg_saran_anonim'));
    expect(k.indexOf('UPDATE public.pengaduan_riwayat')).toBeLessThan(k.indexOf('CREATE TRIGGER trg_pengaduan_anonim'));
    // Tidak menghapus baris, flag dedup, atau jawaban survei.
    expect(k).not.toMatch(/DELETE FROM|TRUNCATE|UPDATE public\.survei_undangan SET (saran|pengaduan)_dikirim = false/);
  });

  it('trigger: identitas dikosongkan tanpa mengikat kolom, waktu dibulatkan ke 00:00 WIB, penanda anonim tidak bisa diubah', () => {
    for (const [tabel, identitas] of [
      ['saran', ['undangan_id', 'kunjungan_id', 'pelapor_nama']],
      ['pengaduan', ['undangan_id', 'kunjungan_id', 'sesi_chat_id', 'kontak', 'pelapor_nama', 'pelapor_email']],
    ] as const) {
      const t = fungsi(sql, `jaga_${tabel}_anonim`);
      expect(t).toContain('SECURITY INVOKER');
      expect(t).toContain('SET search_path = pg_catalog, public');
      // P2-4: UPDATE tidak boleh mengubah anonim (tidak ada penghapusan kontak non-anonim lewat UPDATE).
      expect(t).toMatch(/TG_OP = 'UPDATE'[\s\S]*?NEW\.anonim IS DISTINCT FROM OLD\.anonim[\s\S]*?RAISE EXCEPTION/);
      // P1-3: INSERT anonim dibulatkan; UPDATE mempertahankan waktu yang sudah dibulatkan.
      expect(t).toMatch(HARI_WIB);
      expect(t).toMatch(/NEW\.created_at := OLD\.created_at/);
      // Kolom dikosongkan lewat jsonb_populate_record: kolom yang belum ada (pelapor_email sebelum 0006) diabaikan.
      const kosong = t.match(/jsonb_populate_record\(NEW,\s*'(\{[^']*\})'::jsonb\)/);
      expect(kosong, `jsonb_populate_record ${tabel}`).not.toBeNull();
      expect(Object.keys(JSON.parse(kosong![1])).sort()).toEqual([...identitas].sort());
      expect(Object.values(JSON.parse(kosong![1])).every((v) => v === null)).toBe(true);
      expect(t).not.toMatch(/INSERT INTO|UPDATE public\.|auth\.|queue_notifikasi|audit_log|RAISE (LOG|NOTICE)/);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.jaga_${tabel}_anonim() FROM PUBLIC, anon, authenticated`);
      expect(k).toMatch(new RegExp(`BEFORE INSERT OR UPDATE ON public\\.${tabel}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.jaga_${tabel}_anonim\\(\\)`));
    }
    expect(fungsi(sql, 'jaga_pengaduan_anonim')).toMatch(/NEW\.updated_at := NEW\.created_at/);
    const riwayat = fungsi(sql, 'jaga_riwayat_pengaduan_anonim');
    expect(riwayat).toContain('SECURITY INVOKER');
    expect(riwayat).toMatch(/NEW\.status_lama IS NULL/);
    expect(riwayat).toMatch(/FROM public\.pengaduan AS p WHERE p\.id = NEW\.pengaduan_id AND p\.anonim/);
    expect(k).toMatch(/BEFORE INSERT ON public\.pengaduan_riwayat\s+FOR EACH ROW EXECUTE FUNCTION public\.jaga_riwayat_pengaduan_anonim\(\)/);
  });

  it('CHECK identitas anonim memakai kolom yang sudah ada saja, NOT VALID lalu VALIDATE setelah pembersihan', () => {
    for (const [tabel, kolom] of [
      ['saran', ['undangan_id', 'kunjungan_id', 'pelapor_nama']],
      ['pengaduan', ['undangan_id', 'kunjungan_id', 'sesi_chat_id', 'kontak', 'pelapor_nama']],
    ] as const) {
      const cek = k.match(new RegExp(`ADD CONSTRAINT ${tabel}_anonim_tanpa_identitas CHECK \\(([\\s\\S]*?)\\) NOT VALID;`));
      expect(cek, `CHECK ${tabel}`).not.toBeNull();
      for (const c of kolom) expect(cek![1]).toContain(`${c} IS NULL`);
      expect(cek![1]).not.toContain('pelapor_email');
      expect(k).toContain(`ALTER TABLE public.${tabel} VALIDATE CONSTRAINT ${tabel}_anonim_tanpa_identitas;`);
      expect(k.indexOf(`VALIDATE CONSTRAINT ${tabel}_anonim_tanpa_identitas`)).toBeGreaterThan(k.indexOf('UPDATE public.pengaduan_riwayat'));
    }
  });

  it('RPC survei versi 0003 tidak lagi menyimpan undangan/kunjungan/nama untuk kiriman anonim', () => {
    for (const nama of ['kirim_saran', 'kirim_pengaduan_survei']) {
      const rpc = fungsi(sql, nama);
      expect(rpc).toMatch(/p_token text, p_isi text, p_anonim boolean/);
      expect(rpc).toContain('SECURITY DEFINER');
      expect(rpc).toMatch(/CASE WHEN p_anonim THEN NULL ELSE v_u\.kunjungan_id END/);
      expect(rpc).toMatch(/CASE WHEN p_anonim THEN NULL ELSE v_u\.id END/);
      expect(rpc).toMatch(/CASE WHEN p_anonim THEN NULL ELSE NULLIF\(v_nama, ''\) END/);
      expect(rpc).toMatch(/IF NOT p_anonim THEN\s+SELECT[\s\S]*?FROM public\.kunjungan/);
      expect(rpc).not.toMatch(/email_nyata|pelapor_email|queue_notifikasi|auth\./);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${nama}(text, text, boolean) TO anon, authenticated;`);
    }
    const saran = fungsi(sql, 'kirim_saran');
    expect(saran).toMatch(/pelapor_nama, sumber, anonim\)/);
    expect(saran).toMatch(/'wizard', p_anonim\)/);
  });

  it('dedup satu undangan satu kiriman tetap atomik lewat flag, tanpa mencari balik kiriman anonim', () => {
    for (const [nama, flag, tabel] of [
      ['kirim_saran', 'saran_dikirim', 'saran'],
      ['kirim_pengaduan_survei', 'pengaduan_dikirim', 'pengaduan'],
    ]) {
      const rpc = fungsi(sql, nama);
      const kunci = rpc.indexOf('WHERE u.token = p_token FOR UPDATE;');
      const dedup = rpc.indexOf(`IF v_u.${flag} THEN RETURN`);
      const insert = rpc.indexOf(`INSERT INTO public.${tabel} (`);
      const tandai = rpc.indexOf(`UPDATE public.survei_undangan SET ${flag} = true WHERE id = v_u.id;`);
      expect(kunci).toBeGreaterThan(0);
      expect(dedup).toBeGreaterThan(kunci);
      expect(insert).toBeGreaterThan(dedup);
      expect(tandai).toBeGreaterThan(insert);
      expect(rpc.slice(dedup, insert)).toContain("'duplicate'");
      expect(rpc).not.toMatch(/FROM public\.(saran|pengaduan)\b/);
      for (const hasil of ['invalid', 'not_found', 'belum_survei', 'duplicate', 'expired', 'submitted']) {
        expect(rpc).toContain(`'${hasil}'`);
      }
      expect(rpc).toContain("v_u.diisi_pada + interval '30 minutes'");
    }
  });

  it('P2-3: buat_pengaduan dicabut dari anon/authenticated, tetap untuk service_role; SKM/SPAK dan policy tidak disentuh', () => {
    expect(k).toContain('REVOKE ALL ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;');
    expect(k).toContain('GRANT EXECUTE ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) TO service_role;');
    expect(k).not.toMatch(/(?:ALTER|UPDATE|INSERT INTO|DELETE FROM)\s+public\.(?:skm_respons|spak_respons)/i);
    expect(k).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(?:kirim_survei|get_survei_context)/i);
    expect(k).not.toMatch(/CREATE POLICY|GRANT (?:SELECT|INSERT|UPDATE)|INSERT INTO public\.(?:audit_log|notifikasi|error_log)/i);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
});

describe('rollback 202611030010', () => {
  const rb = baca(ROLLBACK);
  const k = kode(rb);

  it('tanpa BEGIN/COMMIT (lolos --atomic) dan menolak bila 202611030011 masih terpasang', () => {
    expect(mengandungKontrolTransaksi(rb)).toBe(false);
    expect(rb).toMatch(/PRASYARAT ROLLBACK[\s\S]*?202611030011/);
    expect(k).toMatch(/pengaduan_anonim_tanpa_identitas[\s\S]*?pelapor_email[\s\S]*?RAISE EXCEPTION/);
  });

  it('memulihkan RPC 0003 (atau 0006 bila kolom pelapor_email sudah ada) dan hak buat_pengaduan', () => {
    expect(fungsi(rb, 'kirim_saran')).toContain('SECURITY DEFINER');
    expect(fungsi(rb, 'kirim_saran')).not.toMatch(/anonim\)/);
    expect(rb).toMatch(/IF pg_catalog\.to_regclass\('public\.pengaduan'\) IS NOT NULL AND EXISTS[\s\S]*?pelapor_email/);
    expect(rb).toMatch(/EXECUTE \$ddl\$[\s\S]*?public\.email_nyata\(k\.email\)[\s\S]*?\$ddl\$;[\s\S]*?ELSE[\s\S]*?EXECUTE \$ddl\$[\s\S]*?\$ddl\$;/);
    expect(k).toContain('GRANT EXECUTE ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) TO anon, authenticated;');
    expect(k).not.toMatch(/kirim_saran_publik/);
  });

  it('melepas trigger, fungsi, CHECK, dan kolom; tidak mengubah data dan memperingatkan pembersihan permanen', () => {
    for (const t of ['trg_saran_anonim ON public.saran', 'trg_pengaduan_anonim ON public.pengaduan', 'trg_riwayat_pengaduan_anonim ON public.pengaduan_riwayat']) {
      expect(k).toContain(`DROP TRIGGER IF EXISTS ${t}`);
    }
    for (const f of ['jaga_saran_anonim', 'jaga_pengaduan_anonim', 'jaga_riwayat_pengaduan_anonim']) {
      expect(k).toContain(`DROP FUNCTION IF EXISTS public.${f}();`);
    }
    expect(k).toContain('DROP CONSTRAINT IF EXISTS saran_anonim_tanpa_identitas');
    expect(k).toContain('DROP CONSTRAINT IF EXISTS pengaduan_anonim_tanpa_identitas');
    expect(k).toContain('DROP COLUMN IF EXISTS anonim');
    expect(k).not.toMatch(/UPDATE public\.(saran|pengaduan)|DELETE FROM|TRUNCATE|DROP TABLE/);
    expect(rb).toContain('TIDAK BISA DIBATALKAN');
    expect(rb).toContain('membuka kembali celah');
  });
});
