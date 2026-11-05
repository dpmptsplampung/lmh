// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(__dirname, '202611030015_akses_fo_antrean.sql');
const sql = () => existsSync(path) ? readFileSync(path, 'utf8').replace(/--[^\n]*/g, '') : '';

describe('0015 akses FO: kontrak migrasi maju', () => {
  it('menolak rantai sebelum Fase 3, identitas, tiket, dan rekap tanpa mengubah data nyata', () => {
    const text = sql();
    expect(text).toContain('PRASYARAT:');
    for (const nama of ['staf_lingkup()', 'boleh_tiket_baca(uuid,uuid,date)', 'boleh_baca_khusus(uuid)', 'rekap_data_pelayanan(date,date,text,uuid,integer,integer,jsonb,boolean,boolean)']) {
      expect(text).toContain(`to_regprocedure('public.${nama}')`);
    }
    expect(text).toContain('pg_attribute');
    expect(text).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|COLUMN)|UPDATE\s+public\.)/i);
    expect(text).not.toMatch(/^\s*(?:BEGIN|COMMIT);/im);
  });

  it('menutup jendela FO pada data induk, tahap, pendataan dan tiket tanpa mengubah cabang Petugas', () => {
    const text = sql();
    for (const nama of ['boleh_penanganan', 'boleh_kunjungan', 'boleh_baca_pendataan', 'boleh_tiket_baca']) {
      const body = text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
      expect(body, nama).not.toBe('');
      expect(body, nama).toContain('SECURITY DEFINER');
      expect(body, nama).toContain('SET search_path = pg_catalog, public');
    }
    expect(text).toContain("IF v_role = 'front_office' THEN\n    RETURN false;");
    expect(text).toContain("me.role = 'petugas' AND me.layanan_id IS NOT NULL AND me.layanan_id = p_layanan");
    expect(text).toContain('k.dibuat_oleh = v_id');
    expect(text).not.toContain('CREATE POLICY');
  });

  it('daftar bersama dan scan hanya Admin/FO aktif bersesi sah, proyeksi kolom aman, halaman dibatasi', () => {
    const text = sql();
    for (const nama of ['fo_antrean_daftar', 'fo_kunjungan_daftar', 'fo_pratinjau_reservasi']) {
      const body = text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
      expect(body, nama).toContain('public.sesi_valid()');
      expect(body, nama).toContain("v_role NOT IN ('admin', 'front_office')");
      expect(body, nama).not.toMatch(/kontak_hp|email|asal_instansi|keperluan|catatan|to_jsonb\([ktp]\)/i);
      expect(text).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nama}\\([^;]+FROM PUBLIC, anon, authenticated`));
      expect(text).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nama}\\([^;]+TO authenticated;`));
    }
    expect(text.match(/p_batas NOT BETWEEN 1 AND 200/g)).toHaveLength(2);
    expect(text.match(/p_lewati NOT BETWEEN 0 AND 2000000/g)).toHaveLength(2);
  });

  it('ringkasan lintas orang hanya tiga angka; total Petugas tidak mencakup FO atau layanan lain', () => {
    const text = sql();
    const body = text.match(/CREATE OR REPLACE FUNCTION public\.rekap_ringkasan_dilayani\([\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(body).toContain('public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id)');
    expect(body).toContain("v_role <> 'petugas' OR (s.unit = 'layanan' AND s.layanan_id = v_layanan)");
    expect(body).toContain("'saya', v_saya, 'total', v_total, 'persen'");
    expect(body).not.toMatch(/jsonb_agg|to_jsonb|pengunjung|kontak_hp|email|nama/);
    expect(body).toContain('p_tanpa_form');
    expect(body).toContain('public.sesi_valid()');
  });

  it('rollback mengembalikan empat badan helper asli dan mencabut semua RPC baru', () => {
    const rollback = readFileSync(join(__dirname, '../../docs/rollback-akses-fo-antrean-202611030015.sql'), 'utf8');
    const fungsi = (text: string, nama: string) => text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0];
    for (const [nama, file] of [
      ['boleh_penanganan', '202611010003_identitas_satu_kesatuan.sql'],
      ['boleh_kunjungan', '202610290001_koordinator_akses_data.sql'],
      ['boleh_baca_pendataan', '202611010003_identitas_satu_kesatuan.sql'],
      ['boleh_tiket_baca', '202611010002_tiket_antrean_lingkup.sql'],
    ]) {
      expect(fungsi(rollback, nama)).toBe(fungsi(readFileSync(join(__dirname, file), 'utf8'), nama));
    }
    for (const nama of ['fo_antrean_daftar', 'fo_kunjungan_daftar', 'fo_pratinjau_reservasi', 'rekap_ringkasan_dilayani']) {
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${nama}(`);
    }
    expect(rollback).not.toMatch(/^\s*(BEGIN|COMMIT);/im);
  });
});
