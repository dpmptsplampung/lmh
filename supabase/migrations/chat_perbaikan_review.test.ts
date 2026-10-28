// @vitest-environment node
//
// Kontrak statis migrasi 202610310003 (Fase 5, perbaikan review akhir): riwayat lintas sesi (A1), pemilik sesi tetap (A2),
// gerbang hari tanpa pelayanan per Layanan (A4), jendela operasional untuk chat online yang masih terbuka (B).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610310003_chat_perbaikan_review.sql';
const baca = (nama: string) => readFileSync(join(__dirname, nama), 'utf8').replace(/\r\n/g, '\n');
const sql = baca(NAMA_FILE);
const bare = sql.replace(/--[^\n]*/g, '');
const rapikan = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

/** Fungsi utuh dari CREATE sampai penutup ($$; atau END $$;), dirapikan. */
function badan(nama: string, sumber: string, akhir: string): string {
  const mulai = sumber.indexOf(`CREATE OR REPLACE FUNCTION public.${nama}(`);
  expect(mulai, `${nama} ada`).toBeGreaterThanOrEqual(0);
  const tutup = sumber.indexOf(akhir, mulai);
  expect(tutup).toBeGreaterThan(mulai);
  return rapikan(sumber.slice(mulai, tutup + akhir.length));
}
const buang = (teks: string, blok: string) => {
  const n = rapikan(blok);
  expect(teks.split(n).length - 1, `blok muncul tepat sekali: ${n.slice(0, 70)}`).toBe(1);
  return teks.replace(n, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
};

const HARI_INI = "(pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date";

describe('202610310003_chat_perbaikan_review migration', () => {
  it('terdaftar tepat sesudah 202610310002, sebelum 202611010001, dengan prasyarat', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610310002_chat_luar_jam.sql') + 1);
    expect(daftar.indexOf(NAMA_FILE)).toBeLessThan(daftar.indexOf('202611010001_fo_cari_pengunjung.sql'));
    for (const p of [
      'public\\.chat_minta_petugas\\(uuid,boolean\\)',
      'public\\.boleh_chat_sesi\\(uuid\\)',
      'public\\.staf_lingkup\\(\\)',
      'public\\.kunjungan_operasional\\(uuid\\)',
      'public\\.is_layanan_buka_jadwal\\(uuid,date,time without time zone\\)',
      'public\\.chat_ambil\\(uuid,text\\)',
      'public\\.chat_teruskan\\(uuid,uuid,uuid,text\\)',
    ]) {
      expect(bare, p).toMatch(new RegExp(`to_regprocedure\\('${p}'\\) IS NULL`));
    }
  });

  it('aditif (B1): hanya fungsi; tanpa DELETE/TRUNCATE/DROP/tabel/policy/trigger baru', () => {
    expect(bare).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE TRIGGER/i);
    expect(bare).not.toMatch(/;;/);
  });

  it('A1 chat_boleh_riwayat: admin, FO Koordinator, atau petugas Layanan jangkar yang Koordinator/penangan kini', () => {
    const f = badan('chat_boleh_riwayat', bare, '$$;');
    expect(f).toMatch(/STABLE SECURITY DEFINER SET search_path = pg_catalog, public/);
    expect(f).toContain("me.role = 'admin'");
    expect(f).toContain("me.role = 'front_office' AND me.koordinator");
    expect(f).toContain(
      "me.role = 'petugas' AND me.layanan_id IS NOT NULL AND s.layanan_id = me.layanan_id AND (me.koordinator OR s.ditangani_oleh = me.id)",
    );
    // Tidak ada cabang "penangan lama"/jendela operasional (jalur chat_teruskan dan sesi bot FO).
    expect(f).not.toMatch(/penanganan|s\.status/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_boleh_riwayat\(uuid\) TO authenticated, service_role/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_boleh_riwayat\(uuid\) FROM PUBLIC, anon, authenticated/);
  });

  it('A2 chat_sesi_jaga_rpc: salinan 202610140009 + satu blok (pengunjung_id tidak boleh diganti ke nilai lain di luar RPC)', () => {
    const sumber = badan('chat_sesi_jaga_rpc', baca('202610140009_chat_online.sql'), 'END $$;');
    const baru = badan('chat_sesi_jaga_rpc', sql, 'END $$;');
    const BLOK = `IF NEW.pengunjung_id IS DISTINCT FROM OLD.pengunjung_id AND NEW.pengunjung_id IS NOT NULL THEN
      RAISE EXCEPTION 'CHAT_HARUS_RPC: pemilik sesi chat tidak dapat diubah' USING ERRCODE = '42501';
    END IF;`;
    expect(buang(baru, BLOK)).toBe(sumber);
    // Flag RPC tetap membolehkan (return awal sebelum pemeriksaan), SET NULL tidak ditolak.
    expect(baru.indexOf('lmh.chat_rpc')).toBeLessThan(baru.indexOf('NEW.pengunjung_id IS DISTINCT FROM OLD.pengunjung_id'));
    expect(baru).toContain('NEW.pengunjung_id IS NOT NULL');
  });

  describe('A4 gerbang per Layanan: salinan 202610140012, perbedaan hanya pada gerbang', () => {
    const s12 = baca('202610140012_perbaikan_review.sql');

    it('chat_sesi_eskalasi_kunjungan: per NEW.layanan_id', () => {
      const sumber = badan('chat_sesi_eskalasi_kunjungan', s12, 'END $$;');
      const baru = badan('chat_sesi_eskalasi_kunjungan', sql, 'END $$;');
      const a = 'AND NOT public.hari_tanpa_layanan() THEN';
      const b = `AND public.is_layanan_buka_jadwal(NEW.layanan_id, ${HARI_INI}, NULL) THEN`;
      expect(buang(sumber, a)).toBe(buang(baru, b));
    });

    it('chat_pesan_eskalasi_kunjungan: per layanan sesi (layanan_id ikut di-SELECT)', () => {
      const sumber = badan('chat_pesan_eskalasi_kunjungan', s12, 'END $$;');
      const baru = badan('chat_pesan_eskalasi_kunjungan', sql, 'END $$;');
      const hasil = (s: string) =>
        s
          .replace('SELECT s.id, s.status, s.kunjungan_id INTO v_s', '@@SELECT@@')
          .replace('SELECT s.id, s.status, s.kunjungan_id, s.layanan_id INTO v_s', '@@SELECT@@');
      const a = buang(hasil(sumber), 'AND NOT public.hari_tanpa_layanan() THEN');
      const b = buang(hasil(baru), `AND public.is_layanan_buka_jadwal(v_s.layanan_id, ${HARI_INI}, NULL) THEN`);
      expect(a).toBe(b);
      expect(a).toContain('@@SELECT@@');
    });

    it('chat_ambil: gerbang dipindah ke sesudah sesi dimuat dan memakai Layanan sesi', () => {
      const sumber = badan('chat_ambil', s12, 'END $$;');
      const baru = badan('chat_ambil', sql, 'END $$;');
      const LAMA = `IF public.hari_tanpa_layanan() THEN
        RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diambil pada hari tanpa pelayanan (Sabtu/Minggu/hari libur)'
          USING ERRCODE = 'P0001';
      END IF;`;
      const BARU = `IF NOT public.is_layanan_buka_jadwal(v_s.layanan_id, ${HARI_INI}, NULL) THEN
        RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diambil karena layanan tidak beroperasi hari ini (di luar jadwal/hari libur)'
          USING ERRCODE = 'P0001';
      END IF;`;
      const a = buang(sumber, LAMA);
      const b = buang(baru, BARU);
      // Selain pemindahan blok, badan identik: sisipkan BARU tepat sesudah blok NOT_FOUND pada sumber.
      const NOT_FOUND = `RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002'; END IF;`;
      expect(a.split(NOT_FOUND).length - 1).toBe(1);
      expect(a.replace(NOT_FOUND, `${NOT_FOUND} @@GERBANG@@`)).toBe(b.replace(NOT_FOUND, `${NOT_FOUND} @@GERBANG@@`));
      // Urutan: sesi dimuat (v_s) dulu, baru gerbang.
      expect(baru.indexOf('FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE')).toBeLessThan(
        baru.indexOf('public.is_layanan_buka_jadwal(v_s.layanan_id'),
      );
    });

    it('chat_teruskan: gerbang pada Layanan tujuan p_layanan_id', () => {
      const sumber = badan('chat_teruskan', s12, 'END $$;');
      const baru = badan('chat_teruskan', sql, 'END $$;');
      const LAMA = `IF public.hari_tanpa_layanan(v_tgl) THEN
        RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diteruskan pada hari tanpa pelayanan (Sabtu/Minggu/hari libur)'
          USING ERRCODE = 'P0001';
      END IF;`;
      const BARU = `IF NOT public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, NULL) THEN
        RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diteruskan karena layanan tujuan tidak beroperasi hari ini (di luar jadwal/hari libur)'
          USING ERRCODE = 'P0001';
      END IF;`;
      expect(buang(sumber, LAMA)).toBe(buang(baru, BARU));
    });

    it('tidak ada lagi kalender global hari_tanpa_layanan di fungsi chat salinan; grant dipulihkan seperti sumber', () => {
      expect(bare).not.toMatch(/hari_tanpa_layanan\s*\(/);
      expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_ambil\(uuid, text\) TO authenticated/);
      expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_teruskan\(uuid, uuid, uuid, text\) TO authenticated/);
      expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_sesi_eskalasi_kunjungan\(\) FROM PUBLIC, anon, authenticated/);
      expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_pesan_eskalasi_kunjungan\(\) FROM PUBLIC, anon, authenticated/);
    });
  });

  it('B kunjungan_operasional: salinan 202610290001 + satu blok (chat online dengan penanganan terbuka)', () => {
    const sumber = badan('kunjungan_operasional', baca('202610290001_koordinator_akses_data.sql'), '$$;');
    const baru = badan('kunjungan_operasional', sql, '$$;');
    const BLOK = `OR (k.asal = 'online'
      AND EXISTS (SELECT 1 FROM public.penanganan AS pn
                  WHERE pn.kunjungan_id = k.id AND pn.status IN ('menunggu', 'berjalan')))`;
    expect(buang(baru, BLOK)).toBe(sumber);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.kunjungan_operasional\(uuid\) TO authenticated, service_role/);
  });
});
