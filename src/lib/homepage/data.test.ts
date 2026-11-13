import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATAS_MUAT_MS,
  PENGATURAN_BERANDA_BAWAAN,
  denganBatasWaktu,
  ikonKartu,
  muatAntrean,
  muatBlok,
  muatBlokKetat,
  muatLayanan,
  muatLayananKetat,
  muatPengaturanBeranda,
  muatStatusHariIni,
  slugDariNama,
} from './data';

type Hasil = { data: unknown; error: { message: string; code?: string } | null };

// Supabase tiruan: setiap from(tabel).select(kolom) mengembalikan hasil berurutan per tabel; rpc() per nama.
function tiruan(opsi: {
  from?: Record<string, Array<Hasil | 'lempar'>>;
  rpc?: Record<string, Hasil | 'lempar'>;
}) {
  const panggilan: Array<{ tabel: string; kolom: string }> = [];
  const antrean = new Map<string, Array<Hasil | 'lempar'>>(Object.entries(opsi.from ?? {}));
  const sb = {
    from(tabel: string) {
      return {
        select(kolom: string) {
          panggilan.push({ tabel, kolom });
          const next = antrean.get(tabel)?.shift() ?? { data: null, error: { message: 'tak ada' } };
          if (next === 'lempar') return Promise.reject(new Error('jaringan'));
          return Promise.resolve(next);
        },
      };
    },
    rpc(nama: string) {
      const r = opsi.rpc?.[nama] ?? { data: null, error: { message: 'tak ada' } };
      if (r === 'lempar') return Promise.reject(new Error('jaringan'));
      return Promise.resolve(r);
    },
  };
  return { sb: sb as unknown as SupabaseClient, panggilan };
}

const barisPenuh = (o: Record<string, unknown> = {}) => ({
  id: 'id-1',
  nama: 'Helpdesk OSS',
  slug: 'helpdesk-oss',
  deskripsi: 'Bantuan OSS',
  urutan: 100,
  instansi_nama: 'DPMPTSP',
  instansi_singkatan: null,
  website_terkait: [{ label: 'OSS', url: 'https://oss.go.id' }],
  status_tampilan: 'aktif',
  punya_antrean: true,
  punya_chat: true,
  tampil_di_homepage: true,
  tipe: 'konsultatif',
  chatbot_aktif: true,
  ...o,
});

describe('muatLayanan', () => {
  it('memetakan chatbotAktif dan tipe (dipakai /chat); kolom tak terbaca = false / null', async () => {
    const { sb, panggilan } = tiruan({
      from: {
        v_layanan_publik: [{
          data: [
            barisPenuh({ id: 'a', nama: 'A', slug: 'a', tipe: 'modul_publik', chatbot_aktif: false }),
            (() => { const b = barisPenuh({ id: 'b', nama: 'B', slug: 'b' }); delete (b as Record<string, unknown>).tipe; delete (b as Record<string, unknown>).chatbot_aktif; return b; })(),
          ],
          error: null,
        }],
      },
    });
    const { layanan } = await muatLayanan(sb);
    expect(panggilan[0].kolom).toContain('chatbot_aktif');
    expect(panggilan[0].kolom).toContain('tipe');
    expect(layanan.find((l) => l.id === 'a')).toMatchObject({ chatbotAktif: false, tipe: 'modul_publik' });
    expect(layanan.find((l) => l.id === 'b')).toMatchObject({ chatbotAktif: false, tipe: null });
    const { sb: sb2 } = tiruan({ from: { v_layanan_publik: [{ data: [barisPenuh()], error: null }] } });
    expect((await muatLayanan(sb2)).layanan[0]).toMatchObject({ chatbotAktif: true, tipe: 'konsultatif' });
  });

  it('tingkat 1: view lengkap, diurutkan menurut urutan lalu nama', async () => {
    const { sb, panggilan } = tiruan({
      from: {
        v_layanan_publik: [{
          data: [
            barisPenuh({ id: 'b', nama: 'B', slug: 'b', urutan: 5 }),
            barisPenuh({ id: 'a2', nama: 'Z', slug: 'z', urutan: 1 }),
            barisPenuh({ id: 'a1', nama: 'A', slug: 'a', urutan: 1 }),
          ],
          error: null,
        }],
      },
    });
    const { layanan, tingkat } = await muatLayanan(sb);
    expect(tingkat).toBe(1);
    expect(layanan.map((l) => l.id)).toEqual(['a1', 'a2', 'b']);
    expect(panggilan[0].kolom).toContain('tampil_di_homepage');
  });

  it('memetakan instansi, website terkait (hanya https valid), dan saklar', async () => {
    const { sb } = tiruan({
      from: {
        v_layanan_publik: [{
          data: [barisPenuh({
            instansi_singkatan: 'DPM',
            website_terkait: [{ label: 'OSS', url: 'https://oss.go.id' }, { label: 'Buruk', url: 'javascript:x' }, { label: '', url: 'https://a.id' }],
            tampil_di_homepage: false,
            status_tampilan: 'coming_soon',
          })],
          error: null,
        }],
      },
    });
    const [l] = (await muatLayanan(sb)).layanan;
    expect(l.instansi).toBe('DPMPTSP');
    expect(l.instansiSingkatan).toBe('DPM');
    expect(l.websiteTerkait).toEqual([{ label: 'OSS', url: 'https://oss.go.id' }]);
    expect(l.tampilDiHomepage).toBe(false);
    expect(l.statusTampilan).toBe('coming_soon');
  });

  it('tingkat 1 galat -> tingkat 2 (kolom Fase 1, tampil_di_homepage dianggap true)', async () => {
    const { sb, panggilan } = tiruan({
      from: {
        v_layanan_publik: [
          { data: null, error: { message: 'column tampil_di_homepage does not exist' } },
          { data: [(() => { const b = barisPenuh(); delete (b as Record<string, unknown>).tampil_di_homepage; return b; })()], error: null },
        ],
      },
    });
    const { layanan, tingkat } = await muatLayanan(sb);
    expect(tingkat).toBe(2);
    expect(panggilan[1].kolom).not.toContain('tampil_di_homepage');
    expect(layanan[0].tampilDiHomepage).toBe(true);
  });

  it('tingkat 3 (view lama): slug diturunkan dari nama dan dibuat unik', async () => {
    const { sb } = tiruan({
      from: {
        v_layanan_publik: [
          { data: null, error: { message: 'e1' } },
          { data: null, error: { message: 'e2' } },
          {
            data: [
              { id: '1', nama: 'Sertifikasi Halal', status_tampilan: 'aktif', punya_antrean: true, punya_chat: true },
              { id: '2', nama: 'Sertifikasi  Halal!', status_tampilan: 'aktif', punya_antrean: false, punya_chat: true },
            ],
            error: null,
          },
        ],
      },
    });
    const { layanan, tingkat } = await muatLayanan(sb);
    expect(tingkat).toBe(3);
    expect(layanan.find((l) => l.id === '1')?.slug).toBe('sertifikasi-halal');
    expect(layanan.find((l) => l.id === '2')?.slug).toBe('sertifikasi-halal-2');
    expect(layanan[0].deskripsi).toBeNull();
    expect(layanan[0].websiteTerkait).toEqual([]);
  });

  it('semua tingkat galat atau melempar -> daftar kosong tanpa melempar', async () => {
    const { sb } = tiruan({
      from: { v_layanan_publik: [{ data: null, error: { message: 'a' } }, 'lempar', { data: null, error: { message: 'c' } }] },
    });
    await expect(muatLayanan(sb)).resolves.toEqual({ layanan: [], tingkat: 0 });
  });
});

describe('muatBlok', () => {
  it('mengembalikan blok tersusun dari baris DB (blok mati ikut, ditandai aktif=false)', async () => {
    const { sb } = tiruan({
      from: { homepage_blok: [{ data: [{ jenis: 'hero', aktif: false, urutan: 10, teks: {} }], error: null }] },
    });
    const blok = await muatBlok(sb);
    expect(blok).toHaveLength(7);
    expect(blok.find((b) => b.jenis === 'hero')?.aktif).toBe(false);
  });

  it('tabel belum ada (galat) -> bawaan, tidak melempar', async () => {
    const { sb } = tiruan({ from: { homepage_blok: [{ data: null, error: { message: 'relation does not exist' } }] } });
    const blok = await muatBlok(sb);
    expect(blok.find((b) => b.jenis === 'hero')?.aktif).toBe(true);
    expect(blok.find((b) => b.jenis === 'papan_kinerja')?.aktif).toBe(false);
  });

  it('melempar -> bawaan', async () => {
    const { sb } = tiruan({ from: { homepage_blok: ['lempar'] } });
    expect(await muatBlok(sb)).toHaveLength(7);
  });
});

describe('muatStatusHariIni', () => {
  it('memetakan baris RPC ke Map per layanan (jadwal camelCase)', async () => {
    const { sb } = tiruan({
      rpc: {
        layanan_status_hari_ini: {
          data: [
            { layanan_id: 'id-1', buka_sekarang: false, libur_keterangan: null, jadwal: [{ hari: 4, jam_mulai: '08:00', jam_selesai: '15:30' }] },
            { layanan_id: 'id-2', buka_sekarang: false, libur_keterangan: 'Idul Fitri', jadwal: [] },
          ],
          error: null,
        },
      },
    });
    const peta = await muatStatusHariIni(sb);
    expect(peta?.get('id-1')).toEqual({
      buka: false,
      liburKeterangan: null,
      jadwal: [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }],
    });
    expect(peta?.get('id-2')?.liburKeterangan).toBe('Idul Fitri');
  });

  it('RPC belum ada / galat / melempar -> null (status dihilangkan, tidak ditebak)', async () => {
    expect(await muatStatusHariIni(tiruan({ rpc: { layanan_status_hari_ini: { data: null, error: { message: 'x' } } } }).sb)).toBeNull();
    expect(await muatStatusHariIni(tiruan({ rpc: { layanan_status_hari_ini: 'lempar' } }).sb)).toBeNull();
  });
});

// Pemuat KETAT (jalur server ber-cache): turun ke bawaan/tingkat lebih lama HANYA untuk "objek belum ada"; galat sesaat
// (503, jaringan, lemparan) ditandai gagal agar cadangannya tidak tersimpan sebagai hasil lengkap. Pemuat lama tak berubah.
describe('muatLayananKetat', () => {
  const galat = (code?: string) => ({ data: null, error: { message: 'galat', ...(code ? { code } : {}) } });
  const tanpaSaklar = () => {
    const b = barisPenuh();
    delete (b as Record<string, unknown>).tampil_di_homepage;
    return b;
  };

  it('tingkat 1 berhasil: sama dengan muatLayanan', async () => {
    const { sb } = tiruan({ from: { v_layanan_publik: [{ data: [barisPenuh()], error: null }] } });
    const { layanan, tingkat } = await muatLayananKetat(sb);
    expect(tingkat).toBe(1);
    expect(layanan).toHaveLength(1);
  });

  it.each(['42703', 'PGRST204'])('kolom belum ada (%s) -> tingkat 2 (tampil_di_homepage dianggap true)', async (kode) => {
    const { sb, panggilan } = tiruan({
      from: { v_layanan_publik: [galat(kode), { data: [tanpaSaklar()], error: null }] },
    });
    const { layanan, tingkat } = await muatLayananKetat(sb);
    expect(tingkat).toBe(2);
    expect(panggilan).toHaveLength(2);
    expect(layanan[0].tampilDiHomepage).toBe(true);
  });

  it('dua tingkat "belum ada" (42703, lalu 42P01 untuk kolom lama) -> tingkat 3 dengan slug turunan', async () => {
    const { sb } = tiruan({
      from: {
        v_layanan_publik: [
          galat('42703'),
          galat('42703'),
          { data: [{ id: '1', nama: 'Layanan Lama', status_tampilan: 'aktif', punya_antrean: true, punya_chat: true }], error: null },
        ],
      },
    });
    const { layanan, tingkat } = await muatLayananKetat(sb);
    expect(tingkat).toBe(3);
    expect(layanan[0].slug).toBe('layanan-lama');
  });

  it.each([
    ['galat tanpa kode (mis. 503)', galat()],
    ['kode lain (PGRST001 koneksi)', galat('PGRST001')],
    ['kode izin (42501)', galat('42501')],
  ])('%s pada tingkat 1 -> GAGAL seketika, tidak turun ke tingkat 2', async (_nama, balasan) => {
    const { sb, panggilan } = tiruan({
      from: { v_layanan_publik: [balasan, { data: [tanpaSaklar()], error: null }] },
    });
    expect(await muatLayananKetat(sb)).toEqual({ layanan: [], tingkat: 0 });
    expect(panggilan).toHaveLength(1);
  });

  it('lemparan jaringan pada tingkat 1 -> GAGAL seketika', async () => {
    const { sb, panggilan } = tiruan({ from: { v_layanan_publik: ['lempar', { data: [barisPenuh()], error: null }] } });
    expect((await muatLayananKetat(sb)).tingkat).toBe(0);
    expect(panggilan).toHaveLength(1);
  });

  it('tingkat 1 "belum ada" lalu tingkat 2 galat sesaat -> GAGAL, tidak lanjut ke tingkat 3', async () => {
    const { sb, panggilan } = tiruan({
      from: { v_layanan_publik: [galat('42703'), galat(), { data: [barisPenuh()], error: null }] },
    });
    expect((await muatLayananKetat(sb)).tingkat).toBe(0);
    expect(panggilan).toHaveLength(2);
  });

  it('semua tingkat "belum ada" -> GAGAL setelah tiga percobaan', async () => {
    const { sb, panggilan } = tiruan({ from: { v_layanan_publik: [galat('42P01'), galat('42P01'), galat('42P01')] } });
    expect((await muatLayananKetat(sb)).tingkat).toBe(0);
    expect(panggilan).toHaveLength(3);
  });

  it('tanpa galat tetapi data bukan larik -> GAGAL (bentuk tak terduga bukan "belum ada")', async () => {
    const { sb, panggilan } = tiruan({ from: { v_layanan_publik: [{ data: null, error: null }, { data: [barisPenuh()], error: null }] } });
    expect((await muatLayananKetat(sb)).tingkat).toBe(0);
    expect(panggilan).toHaveLength(1);
  });

  it('muatLayanan (perilaku lama) TIDAK berubah: galat sesaat tetap turun ke tingkat 2', async () => {
    const { sb, panggilan } = tiruan({ from: { v_layanan_publik: [galat('PGRST001'), { data: [tanpaSaklar()], error: null }] } });
    const { tingkat, layanan } = await muatLayanan(sb);
    expect(tingkat).toBe(2);
    expect(panggilan).toHaveLength(2);
    expect(layanan[0].tampilDiHomepage).toBe(true);
  });
});

describe('muatBlokKetat', () => {
  const galat = (code?: string) => ({ data: null, error: { message: 'galat', ...(code ? { code } : {}) } });

  it('berhasil: blok tersusun dari baris DB', async () => {
    const { sb } = tiruan({ from: { homepage_blok: [{ data: [{ jenis: 'ajakan', aktif: false, urutan: 5, teks: {} }], error: null }] } });
    const blok = await muatBlokKetat(sb);
    expect(blok).toHaveLength(7);
    expect(blok?.find((b) => b.jenis === 'ajakan')?.aktif).toBe(false);
  });

  it.each(['42P01', 'PGRST205'])('tabel belum ada (%s) -> blok bawaan yang SAH (bukan null)', async (kode) => {
    const { sb } = tiruan({ from: { homepage_blok: [galat(kode)] } });
    const blok = await muatBlokKetat(sb);
    expect(blok).not.toBeNull();
    expect(blok).toHaveLength(7);
    expect(blok?.every((b) => b.aktif === (b.jenis !== 'papan_kinerja'))).toBe(true);
  });

  it.each([
    ['galat tanpa kode (mis. 503)', galat()],
    ['kode lain (PGRST001)', galat('PGRST001')],
    ['bentuk tak terduga (data bukan larik, tanpa galat)', { data: null, error: null }],
  ])('%s -> null (gagal dibaca)', async (_nama, balasan) => {
    const { sb } = tiruan({ from: { homepage_blok: [balasan] } });
    expect(await muatBlokKetat(sb)).toBeNull();
  });

  it('lemparan jaringan -> null', async () => {
    const { sb } = tiruan({ from: { homepage_blok: ['lempar'] } });
    expect(await muatBlokKetat(sb)).toBeNull();
  });

  it('muatBlok (perilaku lama) TIDAK berubah: galat apa pun atau lemparan -> blok bawaan', async () => {
    for (const balasan of [galat(), galat('PGRST001'), galat('42P01'), { data: null, error: null }, 'lempar' as const]) {
      const { sb } = tiruan({ from: { homepage_blok: [balasan] } });
      const blok = await muatBlok(sb);
      expect(blok).toHaveLength(7);
      expect(blok[blok.length - 1].jenis).toBe('footer');
    }
  });
});

describe('muatAntrean', () => {
  it('memetakan v_antrian_loket per layanan', async () => {
    const { sb } = tiruan({
      from: { v_antrian_loket: [{ data: [{ layanan_id: 'id-1', antre_count: 3, dilayani_count: 1, estimasi_tunggu_total_menit: 20 }], error: null }] },
    });
    expect((await muatAntrean(sb))?.get('id-1')).toEqual({ antre: 3, dilayani: 1, estimasiTungguMenit: 20 });
  });
  it('galat -> null', async () => {
    expect(await muatAntrean(tiruan({ from: { v_antrian_loket: [{ data: null, error: { message: 'x' } }] } }).sb)).toBeNull();
  });
});

describe('slugDariNama & ikonKartu', () => {
  it('slugDariNama mengikuti aturan DB (huruf kecil, non-alnum -> tanda hubung, fallback layanan)', () => {
    expect(slugDariNama('Sertifikasi Mutu Keamanan Hasil Perikanan')).toBe('sertifikasi-mutu-keamanan-hasil-perikanan');
    expect(slugDariNama('  Bank Lampung ')).toBe('bank-lampung');
    expect(slugDariNama('!!!')).toBe('layanan');
  });
  it('ikonKartu deterministik per slug', () => {
    expect(ikonKartu('bank-lampung')).toEqual(ikonKartu('bank-lampung'));
    expect(ikonKartu('x').ikon).toMatch(/^[A-Z]/);
  });
});

describe('denganBatasWaktu', () => {
  it('mengembalikan hasil bila selesai sebelum batas', async () => {
    await expect(denganBatasWaktu(Promise.resolve('ok'), 50, 'bawaan')).resolves.toBe('ok');
  });
  it('mengembalikan bawaan bila lewat batas (permintaan menggantung)', async () => {
    vi.useFakeTimers();
    try {
      const menggantung = new Promise<string>(() => {});
      const hasil = denganBatasWaktu(menggantung, 6000, 'bawaan');
      await vi.advanceTimersByTimeAsync(6000);
      await expect(hasil).resolves.toBe('bawaan');
    } finally {
      vi.useRealTimers();
    }
  });
  it('mengembalikan bawaan bila promise menolak', async () => {
    await expect(denganBatasWaktu(Promise.reject(new Error('x')), 50, 'bawaan')).resolves.toBe('bawaan');
  });
  it('batas waktu pemuat etalase = 6 detik', () => {
    expect(BATAS_MUAT_MS).toBe(6000);
  });
});

// site_settings dibaca lewat klien yang DISUNTIKKAN (server: klien anon tanpa cookie), bukan klien peramban.
describe('muatPengaturanBeranda', () => {
  function tiruanPengaturan(hasil: Hasil | 'lempar') {
    const jejak: { tabel?: string; kolom?: string; kunci?: string[]; batas?: number } = {};
    const q = {
      select(kolom: string) {
        jejak.kolom = kolom;
        return q;
      },
      in(_kolom: string, kunci: string[]) {
        jejak.kunci = kunci;
        return q;
      },
      limit(n: number) {
        jejak.batas = n;
        return q;
      },
      then(selesai: (v: Hasil) => unknown, tolak: (e: unknown) => unknown) {
        const janji = hasil === 'lempar' ? Promise.reject(new Error('jaringan')) : Promise.resolve(hasil);
        return janji.then(selesai, tolak);
      },
    };
    const sb = {
      from(tabel: string) {
        jejak.tabel = tabel;
        return q;
      },
    };
    return { sb: sb as unknown as SupabaseClient, jejak };
  }

  it('membaca hanya lima kunci publik dengan batas baris', async () => {
    const { sb, jejak } = tiruanPengaturan({ data: [], error: null });
    await muatPengaturanBeranda(sb);
    expect(jejak.tabel).toBe('site_settings');
    expect(jejak.kolom).toBe('key, value');
    expect(jejak.kunci).toEqual(['wa_number', 'wa_default_message', 'contact_address', 'contact_hours', 'contact_email']);
    expect(jejak.batas).toBe(5);
  });

  it('nilai terisi menimpa bawaan; nilai kosong/spasi dan kunci asing diabaikan', async () => {
    const { sb } = tiruanPengaturan({
      data: [
        { key: 'wa_number', value: '081200000000' },
        { key: 'contact_address', value: 'Jl. Contoh 1' },
        { key: 'contact_hours', value: '   ' },
        { key: 'contact_email', value: null },
        { key: 'kunci_rahasia', value: 'jangan-bocor' },
      ],
      error: null,
    });
    const hasil = (await muatPengaturanBeranda(sb))!;
    expect(hasil.wa_number).toBe('081200000000');
    expect(hasil.contact_address).toBe('Jl. Contoh 1');
    expect(hasil.contact_hours).toBe(PENGATURAN_BERANDA_BAWAAN.contact_hours);
    expect(hasil.contact_email).toBe(PENGATURAN_BERANDA_BAWAAN.contact_email);
    expect(hasil.wa_default_message).toBe(PENGATURAN_BERANDA_BAWAAN.wa_default_message);
    expect(Object.keys(hasil).sort()).toEqual(Object.keys(PENGATURAN_BERANDA_BAWAAN).sort());
  });

  it('galat query atau lemparan -> null (gagal dibaca, beda dari terbaca-tapi-kosong), tidak melempar', async () => {
    expect(await muatPengaturanBeranda(tiruanPengaturan({ data: null, error: { message: 'x' } }).sb)).toBeNull();
    expect(await muatPengaturanBeranda(tiruanPengaturan('lempar').sb)).toBeNull();
  });

  it('terbaca tapi kosong -> bawaan penuh (bukan null)', async () => {
    expect(await muatPengaturanBeranda(tiruanPengaturan({ data: [], error: null }).sb)).toEqual(PENGATURAN_BERANDA_BAWAAN);
  });

  it('mengembalikan salinan: mengubah hasil tidak mengubah bawaan', async () => {
    const hasil = (await muatPengaturanBeranda(tiruanPengaturan({ data: [], error: null }).sb))!;
    hasil.wa_number = 'diubah';
    expect(PENGATURAN_BERANDA_BAWAAN.wa_number).not.toBe('diubah');
  });
});
