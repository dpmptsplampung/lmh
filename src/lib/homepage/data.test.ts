import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  denganBatasWaktu,
  ikonKartu,
  muatAntrean,
  muatBlok,
  muatLayanan,
  muatStatusHariIni,
  slugDariNama,
} from './data';

type Hasil = { data: unknown; error: { message: string } | null };

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
  ...o,
});

describe('muatLayanan', () => {
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
});
