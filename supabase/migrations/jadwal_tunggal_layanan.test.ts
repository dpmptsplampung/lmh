// @vitest-environment node
//
// Kontrak statis migrasi 202610270002 (Fase 1: satu jadwal per Layanan, hari libur global, arsip dan
// saklar antrean menutup gerbang tiket/reservasi). Tes ini hanya membaca teks SQL; tidak ada SQL yang
// dieksekusi ke database.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610270002_jadwal_tunggal_layanan.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

/** Seluruh definisi `CREATE OR REPLACE FUNCTION public.<nama>(` sampai `END $$;` / `$$;` penutupnya. */
function ambilFungsi(nama: string): string {
  const mulai = bare.indexOf(`CREATE OR REPLACE FUNCTION public.${nama}(`);
  expect(mulai, `fungsi ${nama} ada`).toBeGreaterThanOrEqual(0);
  const buka = bare.indexOf('$$', mulai);
  const tutup = bare.indexOf('$$', buka + 2);
  expect(tutup, `fungsi ${nama} tertutup`).toBeGreaterThan(buka);
  return bare.slice(mulai, tutup + 2);
}

describe('202610270002_jadwal_tunggal_layanan migration', () => {
  it('is_layanan_buka_jadwal menolak layanan arsip dan hari libur sebelum pola mingguan', () => {
    const f = ambilFungsi('is_layanan_buka_jadwal');
    expect(f).toMatch(/p_layanan_id uuid,\s+p_tanggal date,\s+p_jam time DEFAULT NULL/);
    expect(f).toMatch(/RETURNS boolean/);
    expect(f).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.layanan AS l WHERE l\.id = p_layanan_id AND l\.aktif = true\) THEN\s+RETURN false;\s+END IF;/);
    expect(f).toMatch(/IF EXISTS \(SELECT 1 FROM public\.hari_libur AS h WHERE h\.tanggal = p_tanggal\) THEN\s+RETURN false;\s+END IF;/);
    const posAktif = f.indexOf('l.aktif = true');
    const posLibur = f.indexOf('FROM public.hari_libur');
    const posPengecualian = f.indexOf('FROM public.jadwal_pengecualian');
    const posStandby = f.indexOf('FROM public.jadwal_standby');
    expect(posAktif).toBeLessThan(posLibur);
    expect(posLibur).toBeLessThan(posPengecualian);
    expect(posPengecualian).toBeLessThan(posStandby);
    expect(f.indexOf('FROM public.layanan')).toBeLessThan(posLibur);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
  });

  it('jadwal_berikutnya disalin tanpa perubahan', () => {
    const f = ambilFungsi('jadwal_berikutnya');
    expect(f).toMatch(/v_limit date := p_dari_tanggal \+ 60/);
    expect(f).toMatch(/public\.is_layanan_buka_jadwal\(p_layanan_id, v, NULL\)/);
  });

  it('layanan_sudah_tutup_untuk menggabungkan batas global dan jam_selesai layanan', () => {
    const f = ambilFungsi('layanan_sudah_tutup_untuk');
    expect(f).toMatch(/p_layanan_id uuid,\s+p_waktu timestamptz DEFAULT now\(\)/);
    expect(f).toMatch(/RETURNS boolean/);
    expect(f).toMatch(/\bSTABLE\b/);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
    expect(f).toMatch(/public\.layanan_sudah_tutup\(p_waktu\)/);
    expect(f).toMatch(/p_waktu AT TIME ZONE 'Asia\/Jakarta'/);
    expect(f).toMatch(/EXTRACT\(ISODOW FROM/);
    // Batas global dulu (OR), lalu pengecualian tanggal, baru pola mingguan.
    expect(f).toMatch(/IF public\.layanan_sudah_tutup\(p_waktu\) THEN\s+RETURN true;\s+END IF;/);
    const posGlobal = f.indexOf('public.layanan_sudah_tutup(p_waktu)');
    const posPengecualian = f.indexOf('FROM public.jadwal_pengecualian');
    const posStandby = f.indexOf('FROM public.jadwal_standby');
    expect(posGlobal).toBeGreaterThan(0);
    expect(posGlobal).toBeLessThan(posPengecualian);
    expect(posPengecualian).toBeLessThan(posStandby);
    // Pengecualian (sama dengan is_layanan_buka_jadwal): libur -> tutup; tanpa jam_mulai -> tutup;
    // selain itu tutup bila jam WIB > jam_selesai pengecualian (default 15:30).
    expect(f).toMatch(/e\.layanan_id = p_layanan_id AND e\.tanggal = v_tgl/);
    expect(f).toMatch(/IF v_exc\.jenis = 'libur' THEN\s+RETURN true;\s+END IF;/);
    expect(f).toMatch(/IF v_exc\.jam_mulai IS NULL THEN\s+RETURN true;\s+END IF;/);
    expect(f).toMatch(/RETURN v_jam > COALESCE\(v_exc\.jam_selesai, time '15:30'\);/);
    // Pola mingguan: baris aktif untuk hari ISODOW WIB; tanpa baris -> tutup; jam WIB > jam_selesai -> tutup.
    expect(f).toMatch(/s\.layanan_id = p_layanan_id\s+AND s\.hari = EXTRACT\(ISODOW FROM v_wib\)::smallint\s+AND s\.aktif = true/);
    expect(f).toMatch(/IF NOT FOUND THEN\s+RETURN true;\s+END IF;\s+RETURN v_jam > v_selesai;/);
    expect(f).toMatch(/v_jam\s+time := \(p_waktu AT TIME ZONE 'Asia\/Jakarta'\)::time/);
    expect(f).toMatch(/v_tgl\s+date := \(p_waktu AT TIME ZONE 'Asia\/Jakarta'\)::date/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.layanan_sudah_tutup_untuk\(uuid, timestamptz\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_sudah_tutup_untuk\(uuid, timestamptz\) TO authenticated/);
  });

  it('fo_eskalasi dan admin_alihkan memakai batas tutup per layanan', () => {
    const eskalasi = ambilFungsi('fo_eskalasi');
    const alihkan = ambilFungsi('admin_alihkan');
    expect(eskalasi).toMatch(/layanan_sudah_tutup_untuk\(p_layanan_id\)/);
    expect(alihkan).toMatch(/layanan_sudah_tutup_untuk\(p_layanan_tujuan\)/);
    for (const f of [eskalasi, alihkan]) {
      expect(f).not.toMatch(/IF public\.layanan_sudah_tutup\(\) THEN/);
      expect(f).toMatch(/RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l\.nama\s+USING ERRCODE = 'P0001'/);
      expect(f).toMatch(/LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini \(libur\/di luar jadwal\/diarsipkan\)/);
      expect(f.indexOf('is_layanan_buka_jadwal')).toBeLessThan(f.indexOf('layanan_sudah_tutup_untuk'));
      expect(f.indexOf('layanan_sudah_tutup_untuk')).toBeLessThan(f.indexOf('public.terbit_tiket('));
    }
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.fo_eskalasi\(uuid, uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.fo_eskalasi\(uuid, uuid, uuid, text\) TO authenticated/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.admin_alihkan\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_alihkan\(uuid, uuid, text\) TO authenticated/);
  });

  it('reservasi_buat tidak lagi menolak akhir pekan untuk loket', () => {
    const f = ambilFungsi('reservasi_buat');
    const cek = f.match(/IF[^\n]*EXTRACT\(ISODOW FROM p_tanggal\) IN \(6, 7\)[^\n]*THEN/);
    expect(cek).not.toBeNull();
    expect(cek![0]).toMatch(/v_tujuan = 'bertemu_seseorang'/);
    expect(f.match(/ISODOW/g)).toHaveLength(1);
    expect(f).toMatch(/FROM public\.hari_libur/);
    expect(f).toMatch(/TANGGAL_TIDAK_VALID: kantor libur pada tanggal tersebut/);
    expect(f).toMatch(/public\.is_layanan_buka_jadwal\(p_layanan_id, p_tanggal, NULL\)/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.reservasi_buat\(text, date, uuid, text, text, time\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.reservasi_buat\(text, date, uuid, text, text, time\) TO authenticated/);
  });

  it('v_antrian_loket memakai saklar punya_antrean, bukan tipe', () => {
    const view = bare.match(/CREATE OR REPLACE VIEW public\.v_antrian_loket AS([\s\S]*?);/i)?.[1];
    expect(view).toBeDefined();
    expect(view).toMatch(/WHERE service\.punya_antrean = true\s+AND service\.aktif = true/);
    expect(view).not.toMatch(/tipe\s*=\s*'konsultatif'/);
    const kolom = [...view!.matchAll(/\bAS (layanan_id|layanan_nama|antre_count|dilayani_count|estimasi_durasi_menit|estimasi_tunggu_total_menit|sample_count)\b/g)].map((m) => m[1]);
    expect(kolom).toEqual(['layanan_id', 'layanan_nama', 'antre_count', 'dilayani_count', 'estimasi_durasi_menit', 'estimasi_tunggu_total_menit', 'sample_count']);
    expect(view).toMatch(/service\.tipe,/);
    expect(bare).toMatch(/REVOKE ALL\s+ON public\.v_antrian_loket FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_antrian_loket TO anon, authenticated/);
  });

  it('layanan baru mendapat jadwal default Senin–Jumat 08:00–15:30', () => {
    const f = ambilFungsi('layanan_isi_jadwal_default');
    expect(f).toMatch(/RETURNS trigger/);
    expect(f).toMatch(/INSERT INTO public\.jadwal_standby \(layanan_id, hari, jam_mulai, jam_selesai, aktif\)/);
    expect(f).toMatch(/generate_series\(1, 5\)/);
    expect(f).toMatch(/time '08:00'/);
    expect(f).toMatch(/time '15:30'/);
    expect(f).toMatch(/ON CONFLICT \(layanan_id, hari\) DO NOTHING/);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_layanan_jadwal_default ON public\.layanan/);
    expect(bare).toMatch(/CREATE TRIGGER trg_layanan_jadwal_default\s+AFTER INSERT ON public\.layanan\s+FOR EACH ROW EXECUTE FUNCTION public\.layanan_isi_jadwal_default\(\)/);
  });

  it('jadwal_standby tidak boleh melewati jam_tutup_layanan', () => {
    const f = ambilFungsi('jadwal_standby_batas_tutup');
    expect(f).toMatch(/RETURNS trigger/);
    expect(f).toMatch(/NEW\.jam_selesai > public\.jam_tutup_layanan\(\)/);
    expect(f).toMatch(/NEW\.jam_mulai >= NEW\.jam_selesai/);
    expect(f).toMatch(/RAISE EXCEPTION 'JADWAL_TIDAK_VALID: [^']*'[\s\S]*?USING ERRCODE = '22023'/);
    expect(bare).toMatch(/DROP TRIGGER IF EXISTS trg_jadwal_standby_batas_tutup ON public\.jadwal_standby/);
    expect(bare).toMatch(/CREATE TRIGGER trg_jadwal_standby_batas_tutup\s+BEFORE INSERT OR UPDATE ON public\.jadwal_standby\s+FOR EACH ROW EXECUTE FUNCTION public\.jadwal_standby_batas_tutup\(\)/);
  });

  it('tidak destruktif dan tidak menyentuh baris layanan/jadwal yang ada', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|DROP\s+(TABLE|COLUMN)/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\.layanan\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\.jadwal_standby\b/i);
    expect(bare).not.toMatch(/\bINSERT\s+INTO\s+public\.layanan\b/i);
    expect(bare).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  // Tes anti-drift: badan fungsi/view yang disalin harus sama dengan sumbernya (setelah komentar dibuang
  // dan spasi dirapatkan), KECUALI blok yang daftar eksplisitnya ada di bawah ini.
  describe('salinan identik dengan sumber kecuali blok yang sengaja diubah', () => {
    const baca = (nama: string) => readFileSync(join(__dirname, nama), 'utf8').replace(/\r\n/g, '\n');
    const rapikan = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    const potong = (src: string, awal: string, akhir: string) => {
      const s = src.indexOf(awal);
      expect(s, `awal "${awal}" ada`).toBeGreaterThanOrEqual(0);
      const e = src.indexOf(akhir, s);
      expect(e, `akhir "${akhir}" ada`).toBeGreaterThan(s);
      return rapikan(src.slice(s, e + akhir.length));
    };
    const buang = (teks: string, blok: string) => {
      const n = rapikan(blok);
      expect(teks.split(n).length - 1, `blok muncul tepat sekali: ${n.slice(0, 60)}`).toBe(1);
      return teks.replace(n, ' ').replace(/\s+/g, ' ').trim();
    };

    const CEK_LAMA = `RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal standby)', v_l.nama
      USING ERRCODE = 'P0001';
    END IF;
    IF public.layanan_sudah_tutup() THEN
      RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
        USING ERRCODE = 'P0001';
    END IF;`;
    const cekBaru = (idVar: string) => `RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal/diarsipkan)', v_l.nama
      USING ERRCODE = 'P0001';
    END IF;
    IF public.layanan_sudah_tutup_untuk(${idVar}) THEN
      RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l.nama USING ERRCODE = 'P0001';
    END IF;`;

    const kasus: Array<{
      nama: string;
      sumber: string;
      awal: string;
      akhir: string;
      lama: string[];
      baru: string[];
    }> = [
      {
        nama: 'fo_eskalasi',
        sumber: '202610140007_wp24_akhiri_dual_write.sql',
        awal: 'CREATE OR REPLACE FUNCTION public.fo_eskalasi(',
        akhir: 'END $$;',
        lama: [CEK_LAMA],
        baru: [cekBaru('p_layanan_id')],
      },
      {
        nama: 'admin_alihkan',
        sumber: '202610140012_perbaikan_review.sql',
        awal: 'CREATE OR REPLACE FUNCTION public.admin_alihkan(',
        akhir: 'END $$;',
        lama: [CEK_LAMA],
        baru: [cekBaru('p_layanan_tujuan')],
      },
      {
        nama: 'reservasi_buat',
        sumber: '202610140012_perbaikan_review.sql',
        awal: 'CREATE OR REPLACE FUNCTION public.reservasi_buat(',
        akhir: 'END $$;',
        lama: [`IF EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN`],
        baru: [
          `IF v_tujuan = 'bertemu_seseorang' AND EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN`,
          `IF EXISTS (SELECT 1 FROM public.hari_libur AS h WHERE h.tanggal = p_tanggal) THEN
             RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: kantor libur pada tanggal tersebut' USING ERRCODE = '22023';
           END IF;`,
        ],
      },
      {
        nama: 'is_layanan_buka_jadwal',
        sumber: '202607290010_jadwal_standby.sql',
        awal: 'CREATE OR REPLACE FUNCTION public.is_layanan_buka_jadwal(',
        akhir: 'END $$;',
        lama: [],
        baru: [
          `IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_id AND l.aktif = true) THEN
             RETURN false;
           END IF;
           IF EXISTS (SELECT 1 FROM public.hari_libur AS h WHERE h.tanggal = p_tanggal) THEN
             RETURN false;
           END IF;`,
        ],
      },
      {
        nama: 'jadwal_berikutnya',
        sumber: '202607290010_jadwal_standby.sql',
        awal: 'CREATE OR REPLACE FUNCTION public.jadwal_berikutnya(',
        akhir: 'END $$;',
        lama: [],
        baru: [],
      },
      {
        nama: 'v_antrian_loket',
        sumber: '202610140007_wp24_akhiri_dual_write.sql',
        awal: 'CREATE OR REPLACE VIEW public.v_antrian_loket AS',
        akhir: 'GROUP BY service.id, service.nama, service.tipe;',
        lama: [`WHERE service.tipe = 'konsultatif'`],
        baru: [`WHERE service.punya_antrean = true`],
      },
    ];

    for (const k of kasus) {
      it(`${k.nama}: sama dengan ${k.sumber} kecuali ${k.lama.length + k.baru.length} blok yang sengaja diubah`, () => {
        let asal = potong(baca(k.sumber), k.awal, k.akhir);
        let baru = potong(readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n'), k.awal, k.akhir);
        for (const b of k.lama) asal = buang(asal, b);
        for (const b of k.baru) baru = buang(baru, b);
        expect(baru).toBe(asal);
      });
    }
  });

  it('terdaftar di manifest', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(NAMA_FILE);
  });
});
