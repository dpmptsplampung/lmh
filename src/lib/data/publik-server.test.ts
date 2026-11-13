// @vitest-environment node
// Data publik ber-cache (SPEC refaktor §5, "Cache (free tier)" + aturan anti-bocor): hanya klien anon tanpa
// cookie, tidak menyentuh sesi, tiap fungsi dibungkus unstable_cache dengan tag yang benar, dan hasil yang
// tidak lengkap (galat SESAAT / menggantung) TIDAK disimpan di Data Cache. Bawaan karena "objek belum ada"
// (migrasi belum diterapkan) adalah hasil sah dan boleh disimpan. (Full Route Cache halaman di luar cakupan test ini.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Balasan = { data: unknown; error: { message: string; code?: string } | null } | 'lempar' | 'menggantung';
type Panggilan = { tabel: string; langkah: Array<[string, ...unknown[]]> };

const h = vi.hoisted(() => ({
  /** Catatan tiap pemanggilan unstable_cache (terjadi saat modul dimuat). */
  pembungkus: [] as Array<{ keyParts?: string[]; opsi?: { tags?: string[]; revalidate?: number | false } }>,
  /** Meniru Data Cache: hanya hasil SUKSES yang tersimpan; cb yang melempar tidak menyimpan apa pun. */
  memo: new Map<string, unknown>(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  rethrow: vi.fn(),
  log: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts?: string[],
    opsi?: { tags?: string[]; revalidate?: number | false },
  ) => {
    h.pembungkus.push({ keyParts, opsi });
    const dasar = JSON.stringify(keyParts);
    return async (...args: unknown[]) => {
      const kunci = dasar + JSON.stringify(args);
      if (h.memo.has(kunci)) return h.memo.get(kunci);
      const nilai = await fn(...args);
      h.memo.set(kunci, nilai);
      return nilai;
    };
  },
}));
vi.mock('next/headers', () => ({ cookies: h.cookies, headers: h.headers }));
vi.mock('next/navigation', () => ({ unstable_rethrow: h.rethrow }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: h.log }));
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }));

import {
  REVALIDASI_DETIK,
  TAG_PUBLIK,
  muatBerandaPublik,
  muatFaqPublik,
  muatLayananPublik,
  muatOpsiLayananPengaduan,
  muatTransparansiPublik,
  rentangKuartalWIB,
} from './publik-server';

// Salinan catatan pembungkus: terisi saat impor di atas, sebelum test mana pun berjalan.
const PEMBUNGKUS = [...h.pembungkus];

/** Klien Supabase tiruan: antrean balasan per tabel/rpc; rantai query dicatat; `await` rantai = balasan. */
function klienTiruan(
  opsi: { from?: Record<string, Balasan[]>; rpc?: Record<string, Balasan | ((args: Record<string, unknown>) => Balasan)> } = {},
) {
  const antrean = new Map<string, Balasan[]>(Object.entries(opsi.from ?? {}).map(([k, v]) => [k, [...v]]));
  const panggilan: Panggilan[] = [];
  const panggilanRpc: Array<{ nama: string; args: Record<string, unknown> }> = [];
  const balas = (b: Balasan | undefined) => {
    if (b === 'lempar') return Promise.reject(new Error('jaringan'));
    if (b === 'menggantung') return new Promise<never>(() => {});
    return Promise.resolve(b ?? { data: null, error: { message: 'tak ada' } });
  };
  const sb = {
    from(tabel: string) {
      const catatan: Panggilan = { tabel, langkah: [] };
      panggilan.push(catatan);
      const q: Record<string, unknown> = {};
      for (const nama of ['select', 'in', 'eq', 'neq', 'order', 'limit']) {
        q[nama] = (...args: unknown[]) => {
          catatan.langkah.push([nama, ...args]);
          return q;
        };
      }
      q.then = (selesai: (v: unknown) => unknown, tolak: (e: unknown) => unknown) =>
        balas(antrean.get(tabel)?.shift()).then(selesai, tolak);
      return q;
    },
    rpc(nama: string, args: Record<string, unknown> = {}) {
      panggilanRpc.push({ nama, args });
      const b = opsi.rpc?.[nama];
      return balas(typeof b === 'function' ? b(args) : b);
    },
  };
  return { sb, panggilan, panggilanRpc };
}

const dipakai = (panggilan: Panggilan[], tabel: string) => panggilan.filter((p) => p.tabel === tabel);

const barisLayanan = (o: Record<string, unknown> = {}) => ({
  id: 'id-1',
  nama: 'Helpdesk OSS',
  slug: 'helpdesk-oss',
  deskripsi: 'Bantuan OSS',
  urutan: 1,
  instansi_nama: 'DPMPTSP',
  instansi_singkatan: null,
  website_terkait: [],
  status_tampilan: 'aktif',
  punya_antrean: true,
  punya_chat: true,
  tampil_di_homepage: true,
  ...o,
});
// Galat SESAAT (tanpa kode "objek belum ada"): 503, koneksi putus, dst.
const galatDb = { data: null, error: { message: 'relation does not exist' } } as const;
const galat503 = { data: null, error: { message: 'Service Unavailable', code: 'PGRST001' } } as const;
// Migrasi belum diterapkan: tabel/kolom/view tidak ada (Postgres 42P01 / 42703, PostgREST PGRST205 / PGRST204).
const galatBelumAda = (code: string) => ({ data: null, error: { message: 'objek belum ada', code } }) as const;
const semuaGagal: Record<string, Balasan[]> = {
  v_layanan_publik: [galatDb, galatDb, galatDb],
};

function pasang(opsi: Parameters<typeof klienTiruan>[0]) {
  const tiruan = klienTiruan(opsi);
  h.createClient.mockImplementation(() => tiruan.sb);
  return tiruan;
}

beforeEach(() => {
  h.memo.clear();
  h.createClient.mockReset();
  h.cookies.mockReset();
  h.headers.mockReset();
  h.rethrow.mockReset();
  h.log.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyek.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'kunci-anon-publik');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('konfigurasi cache', () => {
  it('TAG_PUBLIK dan revalidate sesuai kontrak rencana 4.2', () => {
    expect(TAG_PUBLIK).toEqual({
      beranda: 'publik-beranda',
      layanan: 'publik-layanan',
      faq: 'publik-faq',
      transparansi: 'publik-transparansi',
    });
    expect(REVALIDASI_DETIK).toBe(60);
  });

  it('lima fungsi publik masing-masing dibungkus unstable_cache dengan kunci unik dan revalidate 60', () => {
    expect(PEMBUNGKUS).toHaveLength(5);
    const kunci = PEMBUNGKUS.map((p) => JSON.stringify(p.keyParts));
    expect(new Set(kunci).size).toBe(5);
    for (const p of PEMBUNGKUS) expect(p.opsi?.revalidate).toBe(60);
  });

  it('tag: beranda memuat tag beranda + layanan (isinya daftar layanan), layanan = layanan, faq = faq', () => {
    const tag = (nama: string) => PEMBUNGKUS.find((p) => p.keyParts?.some((k) => k.includes(nama)))?.opsi?.tags;
    expect(tag('beranda')).toEqual([TAG_PUBLIK.beranda, TAG_PUBLIK.layanan]);
    expect(tag('layanan')).toEqual([TAG_PUBLIK.layanan]);
    expect(tag('faq')).toEqual([TAG_PUBLIK.faq]);
  });

  it('tag: opsi layanan pengaduan ikut tag layanan; transparansi ikut tag transparansi + layanan (daftar layanannya)', () => {
    const tag = (nama: string) => PEMBUNGKUS.find((p) => p.keyParts?.some((k) => k.includes(nama)))?.opsi?.tags;
    expect(tag('pengaduan')).toEqual([TAG_PUBLIK.layanan]);
    expect(tag('transparansi')).toEqual([TAG_PUBLIK.transparansi, TAG_PUBLIK.layanan]);
  });

  it('hanya tag dari daftar izin yang dipakai (selaras route revalidasi 4.5)', () => {
    const izin = new Set(Object.values(TAG_PUBLIK));
    for (const p of PEMBUNGKUS) for (const t of p.opsi?.tags ?? []) expect(izin.has(t as never)).toBe(true);
  });
});

describe('aturan anti-bocor: klien anon tanpa sesi', () => {
  it('membuat klien anon dari env publik dengan persistSession=false dan autoRefreshToken=false', async () => {
    pasang({ from: { v_layanan_publik: [{ data: [barisLayanan()], error: null }] } });
    await muatLayananPublik();
    expect(h.createClient).toHaveBeenCalledTimes(1);
    const [url, kunci, opsi] = h.createClient.mock.calls[0];
    expect(url).toBe('https://proyek.supabase.co');
    expect(kunci).toBe('kunci-anon-publik');
    expect(opsi.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });

  it('tidak pernah mengakses cookies() atau headers() pada ketiga fungsi', async () => {
    pasang({
      from: {
        homepage_blok: [{ data: [], error: null }],
        v_layanan_publik: [{ data: [barisLayanan()], error: null }, { data: [barisLayanan()], error: null }],
        site_settings: [{ data: [], error: null }],
        faq_knowledge_base: [{ data: [], error: null }],
      },
    });
    await muatBerandaPublik();
    await muatLayananPublik();
    await muatFaqPublik();
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
  });

  it('sumber: server-only, tanpa lib/supabase/{server,service,client}, tanpa next/headers/cookies()/headers()', () => {
    const sumber = readFileSync(join(process.cwd(), 'src/lib/data/publik-server.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(sumber).toMatch(/^\s*import\s+['"]server-only['"]/m);
    expect(sumber).not.toMatch(/supabase\/(server|service|client)/);
    expect(sumber).not.toMatch(/next\/headers/);
    expect(sumber).not.toMatch(/\bcookies\s*\(/);
    expect(sumber).not.toMatch(/\bheaders\s*\(/);
    expect(sumber).not.toMatch(/@supabase\/ssr/);
    expect(sumber).not.toMatch(/SERVICE_ROLE/i);
  });
});

describe('muatBerandaPublik', () => {
  it('menyusun blok, layanan publik, dan pengaturan situs dari satu klien anon', async () => {
    const { panggilan } = pasang({
      from: {
        homepage_blok: [{ data: [{ jenis: 'ajakan', aktif: false, urutan: 5, teks: { title: 'Ayo' } }], error: null }],
        v_layanan_publik: [{ data: [barisLayanan(), barisLayanan({ id: 'id-2', nama: 'Bank', slug: 'bank', urutan: 2 })], error: null }],
        site_settings: [{ data: [{ key: 'contact_address', value: 'Jl. Contoh 1' }], error: null }],
      },
    });
    const hasil = await muatBerandaPublik();
    expect(hasil.layananGalat).toBe(false);
    expect(hasil.layanan.map((l) => l.slug)).toEqual(['helpdesk-oss', 'bank']);
    expect(hasil.blok.find((b) => b.jenis === 'ajakan')?.aktif).toBe(false);
    expect(hasil.blok.find((b) => b.jenis === 'hero')?.aktif).toBe(true);
    expect(hasil.pengaturan.contact_address).toBe('Jl. Contoh 1');
    expect(hasil.pengaturan.wa_number).toBeTruthy();
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(dipakai(panggilan, 'site_settings')).toHaveLength(1);
  });

  it('hasilnya JSON-aman (unstable_cache menyimpan JSON): tanpa Map/fungsi', async () => {
    pasang({
      from: {
        homepage_blok: [{ data: [], error: null }],
        v_layanan_publik: [{ data: [barisLayanan()], error: null }],
        site_settings: [{ data: [], error: null }],
      },
    });
    const hasil = await muatBerandaPublik();
    expect(JSON.parse(JSON.stringify(hasil))).toEqual(hasil);
  });

  it('fallback berlapis tetap bekerja untuk "kolom/tabel belum ada": tingkat 1 dan 2 (42703), blok (42P01), tingkat 3 dipakai dan DISIMPAN', async () => {
    const { panggilan } = pasang({
      from: {
        homepage_blok: [galatBelumAda('42P01')],
        v_layanan_publik: [
          galatBelumAda('42703'),
          galatBelumAda('42703'),
          { data: [{ id: 'lama-1', nama: 'Layanan Lama', status_tampilan: 'aktif', punya_antrean: true, punya_chat: true }], error: null },
        ],
        site_settings: [{ data: [], error: null }],
      },
    });
    const hasil = await muatBerandaPublik();
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(3);
    expect(hasil.layananGalat).toBe(false);
    expect(hasil.layanan).toHaveLength(1);
    expect(hasil.layanan[0]).toMatchObject({ id: 'lama-1', nama: 'Layanan Lama', slug: 'layanan-lama' });
    // tabel homepage_blok belum ada -> blok bawaan (semua tujuh jenis, footer terakhir) dan dianggap LENGKAP.
    expect(hasil.blok).toHaveLength(7);
    expect(hasil.blok[hasil.blok.length - 1].jenis).toBe('footer');
    expect(hasil.pengaturan.contact_email).toBeTruthy();
    expect(h.memo.size).toBe(1);
  });

  describe('galat SESAAT vs "objek belum ada" (hasil cadangan tidak boleh tersimpan sebagai hasil lengkap)', () => {
    const aman: Record<string, Balasan[]> = {
      v_layanan_publik: [{ data: [barisLayanan()], error: null }],
      site_settings: [{ data: [], error: null }],
    };

    it('blok: 503 -> bawaan dipakai sekali ini tetapi hasil TIDAK disimpan; setelah pulih blok kustom terbaca', async () => {
      pasang({ from: { homepage_blok: [galat503], ...aman } });
      const hasil = await muatBerandaPublik();
      expect(hasil.blok).toHaveLength(7);
      expect(hasil.blok.find((b) => b.jenis === 'ajakan')?.aktif).toBe(true); // bawaan
      expect(hasil.layananGalat).toBe(false);
      expect(h.memo.size).toBe(0);

      pasang({
        from: {
          homepage_blok: [{ data: [{ jenis: 'ajakan', aktif: false, urutan: 5, teks: {} }], error: null }],
          v_layanan_publik: [{ data: [barisLayanan()], error: null }],
          site_settings: [{ data: [], error: null }],
        },
      });
      const pulih = await muatBerandaPublik();
      expect(pulih.blok.find((b) => b.jenis === 'ajakan')?.aktif).toBe(false); // kustom admin, bukan bawaan yang tertahan
      expect(h.memo.size).toBe(1);
    });

    it.each(['42P01', 'PGRST205'])('blok: tabel belum ada (%s) -> bawaan dianggap LENGKAP dan disimpan', async (kode) => {
      pasang({ from: { homepage_blok: [galatBelumAda(kode)], ...aman } });
      const hasil = await muatBerandaPublik();
      expect(hasil.blok).toHaveLength(7);
      expect(hasil.layananGalat).toBe(false);
      expect(h.memo.size).toBe(1);
    });

    it('blok: lemparan jaringan -> tidak lengkap, tidak disimpan', async () => {
      pasang({ from: { homepage_blok: ['lempar'], ...aman } });
      const hasil = await muatBerandaPublik();
      expect(hasil.blok).toHaveLength(7);
      expect(h.memo.size).toBe(0);
    });

    it('layanan: galat sesaat pada tingkat 1 TIDAK turun diam-diam ke tingkat 2 (layanan tersembunyi tidak muncul lagi)', async () => {
      const { panggilan } = pasang({
        from: {
          homepage_blok: [{ data: [], error: null }],
          v_layanan_publik: [
            galat503,
            // tingkat 2 tidak punya tampil_di_homepage: bila dipakai, layanan yang disembunyikan admin akan tampil lagi.
            { data: [barisLayanan({ tampil_di_homepage: undefined })], error: null },
          ],
          site_settings: [{ data: [], error: null }],
        },
      });
      const hasil = await muatBerandaPublik();
      expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(1);
      expect(hasil.layananGalat).toBe(true);
      expect(hasil.layanan).toEqual([]);
      expect(h.memo.size).toBe(0);
    });

    it('layanan: lemparan jaringan pada tingkat 1 -> galat, tidak turun tingkat, tidak disimpan', async () => {
      const { panggilan } = pasang({
        from: {
          homepage_blok: [{ data: [], error: null }],
          v_layanan_publik: ['lempar', { data: [barisLayanan()], error: null }],
          site_settings: [{ data: [], error: null }],
        },
      });
      const hasil = await muatBerandaPublik();
      expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(1);
      expect(hasil.layananGalat).toBe(true);
      expect(h.memo.size).toBe(0);
    });

    it.each(['42703', 'PGRST204'])('layanan: kolom belum ada (%s) pada tingkat 1 -> turun ke tingkat 2 dan hasil LENGKAP disimpan', async (kode) => {
      const { panggilan } = pasang({
        from: {
          homepage_blok: [{ data: [], error: null }],
          v_layanan_publik: [galatBelumAda(kode), { data: [barisLayanan()], error: null }],
          site_settings: [{ data: [], error: null }],
        },
      });
      const hasil = await muatBerandaPublik();
      expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(2);
      expect(hasil.layananGalat).toBe(false);
      expect(hasil.layanan).toHaveLength(1);
      expect(h.memo.size).toBe(1);
    });

    it('layanan: tingkat 1 "kolom belum ada" lalu tingkat 2 galat sesaat -> galat, tidak lanjut ke tingkat 3, tidak disimpan', async () => {
      const { panggilan } = pasang({
        from: {
          homepage_blok: [{ data: [], error: null }],
          v_layanan_publik: [galatBelumAda('42703'), galat503, { data: [barisLayanan()], error: null }],
          site_settings: [{ data: [], error: null }],
        },
      });
      const hasil = await muatBerandaPublik();
      expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(2);
      expect(hasil.layananGalat).toBe(true);
      expect(h.memo.size).toBe(0);
    });
  });

  it('ketiga tingkat v_layanan_publik "belum ada" (42P01): galat=true setelah 3 percobaan dan tidak disimpan', async () => {
    const { panggilan } = pasang({
      from: {
        homepage_blok: [{ data: [], error: null }],
        v_layanan_publik: [galatBelumAda('42P01'), galatBelumAda('42P01'), galatBelumAda('42P01')],
        site_settings: [{ data: [], error: null }],
      },
    });
    const hasil = await muatBerandaPublik();
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(3);
    expect(hasil.layananGalat).toBe(true);
    expect(h.memo.size).toBe(0);
  });

  it('semua tingkat layanan gagal: galat=true, halaman tetap dapat dirender, dan hasil TIDAK disimpan di cache', async () => {
    const gagal = pasang({ from: { homepage_blok: [{ data: [], error: null }], ...semuaGagal, site_settings: [{ data: [], error: null }] } });
    const hasil = await muatBerandaPublik();
    expect(hasil.layananGalat).toBe(true);
    expect(hasil.layanan).toEqual([]);
    expect(hasil.blok).toHaveLength(7);
    expect(dipakai(gagal.panggilan, 'v_layanan_publik')).toHaveLength(1); // galat sesaat: tidak mencoba tingkat lain
    expect(h.memo.size).toBe(0);

    // DB pulih -> panggilan berikutnya membaca DB lagi (bukan galat yang tertahan), lalu hasil sukses tersimpan.
    const pulih = pasang({
      from: {
        homepage_blok: [{ data: [], error: null }],
        v_layanan_publik: [{ data: [barisLayanan()], error: null }],
        site_settings: [{ data: [], error: null }],
      },
    });
    const kedua = await muatBerandaPublik();
    expect(kedua.layananGalat).toBe(false);
    expect(kedua.layanan).toHaveLength(1);
    expect(h.memo.size).toBe(1);

    const ketiga = await muatBerandaPublik();
    expect(ketiga).toEqual(kedua);
    expect(dipakai(pulih.panggilan, 'v_layanan_publik')).toHaveLength(1); // dijawab cache, tanpa kueri baru
  });

  it('site_settings gagal dibaca: memakai bawaan untuk sekali ini tetapi tidak disimpan (nomor WhatsApp bawaan tidak boleh menetap)', async () => {
    pasang({
      from: {
        homepage_blok: [{ data: [], error: null }],
        v_layanan_publik: [{ data: [barisLayanan()], error: null }],
        site_settings: [galatDb],
      },
    });
    const hasil = await muatBerandaPublik();
    expect(hasil.layananGalat).toBe(false);
    expect(hasil.layanan).toHaveLength(1);
    expect(hasil.pengaturan.wa_number).toBeTruthy();
    expect(h.memo.size).toBe(0);
  });

  it('permintaan menggantung: setelah 6 detik memakai bawaan (galat layanan) dan tidak disimpan', async () => {
    vi.useFakeTimers();
    pasang({
      from: {
        homepage_blok: ['menggantung'],
        v_layanan_publik: ['menggantung'],
        site_settings: ['menggantung'],
      },
    });
    let selesai = false;
    const janji = muatBerandaPublik().then((v) => {
      selesai = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(5900);
    expect(selesai).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const hasil = await janji;
    expect(hasil.layananGalat).toBe(true);
    expect(hasil.layanan).toEqual([]);
    expect(hasil.blok).toHaveLength(7);
    expect(hasil.pengaturan.wa_number).toBeTruthy();
    expect(h.memo.size).toBe(0);
  });

  it('galat tak terduga (mis. env hilang sehingga createClient melempar): bawaan aman + dicatat, tidak melempar', async () => {
    h.createClient.mockImplementation(() => {
      throw new Error('supabaseUrl is required');
    });
    const hasil = await muatBerandaPublik();
    expect(hasil.layananGalat).toBe(true);
    expect(hasil.layanan).toEqual([]);
    expect(hasil.blok).toHaveLength(7);
    expect(h.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'publik.beranda_gagal' }));
    expect(h.memo.size).toBe(0);
  });

  it('galat internal Next (redirect/bailout dinamis) diteruskan lewat unstable_rethrow, bukan ditelan', async () => {
    const internal = new Error('DYNAMIC_SERVER_USAGE');
    h.createClient.mockImplementation(() => {
      throw internal;
    });
    h.rethrow.mockImplementation((e: unknown) => {
      throw e;
    });
    await expect(muatBerandaPublik()).rejects.toBe(internal);
    expect(h.rethrow).toHaveBeenCalledWith(internal);
  });
});

describe('muatLayananPublik', () => {
  it('mengembalikan layanan publik penuh (termasuk yang tanpa kartu beranda)', async () => {
    pasang({
      from: {
        v_layanan_publik: [{ data: [barisLayanan(), barisLayanan({ id: 'id-2', nama: 'Tersembunyi', slug: 'tersembunyi', tampil_di_homepage: false })], error: null }],
      },
    });
    const hasil = await muatLayananPublik();
    expect(hasil.galat).toBe(false);
    expect(hasil.layanan.map((l) => l.slug)).toEqual(['helpdesk-oss', 'tersembunyi']);
    expect(JSON.parse(JSON.stringify(hasil))).toEqual(hasil);
  });

  it('semua tingkat gagal: { layanan: [], galat: true } dan tidak disimpan', async () => {
    pasang({ from: semuaGagal });
    expect(await muatLayananPublik()).toEqual({ layanan: [], galat: true });
    expect(h.memo.size).toBe(0);
  });

  it('galat sesaat pada tingkat 1: galat, tidak turun ke tingkat 2, tidak disimpan', async () => {
    const { panggilan } = pasang({
      from: { v_layanan_publik: [galat503, { data: [barisLayanan({ tampil_di_homepage: undefined })], error: null }] },
    });
    expect(await muatLayananPublik()).toEqual({ layanan: [], galat: true });
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(1);
    expect(h.memo.size).toBe(0);
  });

  it('kolom belum ada (42703) pada tingkat 1: turun ke tingkat 2, lengkap, disimpan', async () => {
    const { panggilan } = pasang({
      from: { v_layanan_publik: [galatBelumAda('42703'), { data: [barisLayanan()], error: null }] },
    });
    const hasil = await muatLayananPublik();
    expect(hasil.galat).toBe(false);
    expect(hasil.layanan).toHaveLength(1);
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(2);
    expect(h.memo.size).toBe(1);
  });

  it('hasil sukses dijawab cache pada panggilan kedua', async () => {
    const { panggilan } = pasang({ from: { v_layanan_publik: [{ data: [barisLayanan()], error: null }] } });
    await muatLayananPublik();
    await muatLayananPublik();
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(1);
  });
});

describe('muatFaqPublik', () => {
  it('membaca FAQ aktif dengan kolom eksplisit, urut, dan berbatas', async () => {
    const { panggilan } = pasang({
      from: {
        faq_knowledge_base: [{
          data: [
            { id: 'f1', pertanyaan: 'Apa itu OSS?', jawaban: 'Sistem perizinan.', layanan_id: 'id-1', urutan: 1 },
            { id: 'f2', pertanyaan: 'Jam buka?', jawaban: '08.00', layanan_id: null, urutan: null },
            { id: 'rusak', pertanyaan: null, jawaban: 'x', layanan_id: null, urutan: 3 },
          ],
          error: null,
        }],
      },
    });
    const hasil = await muatFaqPublik();
    expect(hasil.galat).toBe(false);
    expect(hasil.faq).toEqual([
      { id: 'f1', pertanyaan: 'Apa itu OSS?', jawaban: 'Sistem perizinan.', layanan_id: 'id-1', urutan: 1 },
      { id: 'f2', pertanyaan: 'Jam buka?', jawaban: '08.00', layanan_id: null, urutan: null },
    ]);
    const langkah = dipakai(panggilan, 'faq_knowledge_base')[0].langkah;
    expect(langkah).toContainEqual(['select', 'id, pertanyaan, jawaban, layanan_id, urutan']);
    expect(langkah).toContainEqual(['eq', 'aktif', true]);
    expect(langkah).toContainEqual(['order', 'urutan', { ascending: true }]);
    expect(langkah.some(([nama, n]) => nama === 'limit' && typeof n === 'number' && n > 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(hasil))).toEqual(hasil);
  });

  it('galat -> { faq: [], galat: true } dan tidak disimpan', async () => {
    pasang({ from: { faq_knowledge_base: [galatDb] } });
    expect(await muatFaqPublik()).toEqual({ faq: [], galat: true });
    expect(h.memo.size).toBe(0);
  });

  it('lemparan jaringan juga menjadi galat (tidak melempar)', async () => {
    pasang({ from: { faq_knowledge_base: ['lempar'] } });
    expect(await muatFaqPublik()).toEqual({ faq: [], galat: true });
  });
});

describe('muatOpsiLayananPengaduan (pilihan layanan formulir pengaduan)', () => {
  it('membaca tabel layanan aktif dengan kolom eksplisit, urut nama, berbatas; mengembalikan {id, nama}', async () => {
    const { panggilan } = pasang({
      from: {
        layanan: [{
          data: [
            { id: 'l1', nama: 'Bank Lampung' },
            { id: 'l2', nama: 'Konsultasi OSS' },
            { id: 'rusak', nama: null },
            { id: 7, nama: 'ID bukan string' },
          ],
          error: null,
        }],
      },
    });
    const hasil = await muatOpsiLayananPengaduan();
    expect(hasil).toEqual({
      layanan: [
        { id: 'l1', nama: 'Bank Lampung' },
        { id: 'l2', nama: 'Konsultasi OSS' },
      ],
      galat: false,
    });
    const langkah = dipakai(panggilan, 'layanan')[0].langkah;
    expect(langkah).toContainEqual(['select', 'id, nama']);
    expect(langkah).toContainEqual(['eq', 'aktif', true]);
    expect(langkah).toContainEqual(['order', 'nama']);
    expect(langkah.some(([nama, n]) => nama === 'limit' && typeof n === 'number' && n > 0)).toBe(true);
    // Pilihan yang terlihat pengguna = semua layanan aktif (sama dengan kueri lama di peramban), bukan v_layanan_publik.
    expect(dipakai(panggilan, 'v_layanan_publik')).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(hasil))).toEqual(hasil);
  });

  it('daftar kosong yang sah (tanpa galat) disimpan; panggilan kedua dijawab cache', async () => {
    const { panggilan } = pasang({ from: { layanan: [{ data: [], error: null }] } });
    expect(await muatOpsiLayananPengaduan()).toEqual({ layanan: [], galat: false });
    expect(h.memo.size).toBe(1);
    await muatOpsiLayananPengaduan();
    expect(dipakai(panggilan, 'layanan')).toHaveLength(1);
  });

  it('galat -> { layanan: [], galat: true } dan tidak disimpan; setelah pulih terbaca lagi', async () => {
    pasang({ from: { layanan: [galatDb] } });
    expect(await muatOpsiLayananPengaduan()).toEqual({ layanan: [], galat: true });
    expect(h.memo.size).toBe(0);
    pasang({ from: { layanan: [{ data: [{ id: 'l1', nama: 'Bank' }], error: null }] } });
    expect((await muatOpsiLayananPengaduan()).layanan).toHaveLength(1);
    expect(h.memo.size).toBe(1);
  });

  it('lemparan jaringan dan permintaan menggantung menjadi galat (tidak melempar, tidak disimpan)', async () => {
    pasang({ from: { layanan: ['lempar'] } });
    expect(await muatOpsiLayananPengaduan()).toEqual({ layanan: [], galat: true });
    vi.useFakeTimers();
    pasang({ from: { layanan: ['menggantung'] } });
    const janji = muatOpsiLayananPengaduan();
    await vi.advanceTimersByTimeAsync(6100);
    expect(await janji).toEqual({ layanan: [], galat: true });
    expect(h.memo.size).toBe(0);
  });

  it('tidak mengakses cookies() atau headers()', async () => {
    pasang({ from: { layanan: [{ data: [], error: null }] } });
    await muatOpsiLayananPengaduan();
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
  });
});

describe('rentangKuartalWIB', () => {
  it('kuartal berjalan menurut kalender WIB: awal kuartal sampai hari ini', () => {
    expect(rentangKuartalWIB(new Date('2026-11-11T03:00:00Z'))).toEqual({ mulai: '2026-10-01', selesai: '2026-11-11' });
    expect(rentangKuartalWIB(new Date('2026-01-15T10:00:00Z'))).toEqual({ mulai: '2026-01-01', selesai: '2026-01-15' });
    expect(rentangKuartalWIB(new Date('2026-06-30T05:00:00Z'))).toEqual({ mulai: '2026-04-01', selesai: '2026-06-30' });
  });

  it('batas hari memakai WIB, bukan UTC: 00.30 WIB 1 April sudah kuartal baru, 23.59 WIB 30 September masih kuartal lama', () => {
    // 2026-03-31T17:30Z = 2026-04-01 00:30 WIB
    expect(rentangKuartalWIB(new Date('2026-03-31T17:30:00Z'))).toEqual({ mulai: '2026-04-01', selesai: '2026-04-01' });
    // 2026-09-30T16:59Z = 2026-09-30 23:59 WIB
    expect(rentangKuartalWIB(new Date('2026-09-30T16:59:00Z'))).toEqual({ mulai: '2026-07-01', selesai: '2026-09-30' });
    // pergantian tahun: 2026-12-31T20:00Z = 2027-01-01 03:00 WIB
    expect(rentangKuartalWIB(new Date('2026-12-31T20:00:00Z'))).toEqual({ mulai: '2027-01-01', selesai: '2027-01-01' });
  });

  it('awal kuartal selalu tanggal 1 dan tidak mundur sehari (bug lama toISOString di zona UTC+7)', () => {
    for (const bulan of ['01', '04', '07', '10']) {
      const { mulai } = rentangKuartalWIB(new Date(`2026-${bulan}-20T05:00:00Z`));
      expect(mulai).toBe(`2026-${bulan}-01`);
    }
  });
});

describe('muatTransparansiPublik (IKM publik per layanan, kuartal berjalan)', () => {
  const layananDb = [
    { id: 'l1', nama: 'Bank Lampung' },
    { id: 'l2', nama: 'Konsultasi OSS' },
  ];
  const ikmRpc = (args: Record<string, unknown>): Balasan => {
    const id = args.p_layanan_id as string;
    return id === 'l1'
      ? { data: [{ layanan_id: 'l1', layanan_nama: 'Bank Lampung', ikm: '82.5', responden: 12 }], error: null }
      : { data: [], error: null };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T03:00:00Z'));
  });

  it('daftar layanan dari tabel layanan (bukan modul_publik, urut nama, berbatas) + hitung_ikm per layanan untuk rentang kuartal WIB', async () => {
    const { panggilan, panggilanRpc } = pasang({ from: { layanan: [{ data: layananDb, error: null }] }, rpc: { hitung_ikm: ikmRpc } });
    const hasil = await muatTransparansiPublik();

    const langkah = dipakai(panggilan, 'layanan')[0].langkah;
    expect(langkah).toContainEqual(['select', 'id, nama']);
    expect(langkah).toContainEqual(['eq', 'aktif', true]); // layanan arsip tidak tampil
    expect(langkah).toContainEqual(['neq', 'tipe', 'modul_publik']);
    expect(langkah).toContainEqual(['order', 'nama']);
    expect(langkah.some(([nama, n]) => nama === 'limit' && typeof n === 'number' && n > 0)).toBe(true);

    expect(panggilanRpc.map((p) => p.nama)).toEqual(['hitung_ikm', 'hitung_ikm']);
    expect(panggilanRpc.map((p) => p.args)).toEqual([
      { p_layanan_id: 'l1', p_start: '2026-10-01', p_end: '2026-11-11' },
      { p_layanan_id: 'l2', p_start: '2026-10-01', p_end: '2026-11-11' },
    ]);

    expect(hasil.galat).toBe(false);
    expect(hasil.rows).toEqual([
      { layanan_id: 'l1', layanan_nama: 'Bank Lampung', ikm: 82.5, responden: 12 },
      { layanan_id: 'l2', layanan_nama: 'Konsultasi OSS', ikm: null, responden: 0 },
    ]);
    expect(hasil.diperbaruiPada).toBe('2026-11-11T03:00:00.000Z');
    expect(JSON.parse(JSON.stringify(hasil))).toEqual(hasil);
    expect(h.memo.size).toBe(1);
  });

  it('rentang kuartal ikut kunci cache: hari berbeda = entri berbeda, hari yang sama dijawab cache', async () => {
    const { panggilanRpc } = pasang({
      from: { layanan: [{ data: layananDb, error: null }, { data: layananDb, error: null }, { data: layananDb, error: null }] },
      rpc: { hitung_ikm: ikmRpc },
    });
    await muatTransparansiPublik();
    await muatTransparansiPublik();
    expect(panggilanRpc).toHaveLength(2); // panggilan kedua dari cache
    vi.setSystemTime(new Date('2026-11-12T03:00:00Z'));
    await muatTransparansiPublik();
    expect(panggilanRpc).toHaveLength(4);
    expect(panggilanRpc[2].args).toMatchObject({ p_start: '2026-10-01', p_end: '2026-11-12' });
    expect(h.memo.size).toBe(2);
  });

  it('hitung_ikm gagal untuk satu layanan: barisnya N/A (seperti sebelumnya) tetapi hasil TIDAK disimpan', async () => {
    pasang({
      from: { layanan: [{ data: layananDb, error: null }] },
      rpc: { hitung_ikm: (args) => (args.p_layanan_id === 'l2' ? galatDb : ikmRpc(args)) },
    });
    const hasil = await muatTransparansiPublik();
    expect(hasil.galat).toBe(false);
    expect(hasil.rows).toEqual([
      { layanan_id: 'l1', layanan_nama: 'Bank Lampung', ikm: 82.5, responden: 12 },
      { layanan_id: 'l2', layanan_nama: 'Konsultasi OSS', ikm: null, responden: 0 },
    ]);
    expect(h.memo.size).toBe(0);
    expect(h.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'publik.transparansi_ikm_sebagian', nGagal: 1 }));
  });

  it('nama dari hasil RPC dipakai bila ada, ikm null tetap null, responden kosong menjadi 0', async () => {
    pasang({
      from: { layanan: [{ data: [{ id: 'l1', nama: 'Nama Tabel' }], error: null }] },
      rpc: { hitung_ikm: { data: [{ layanan_id: 'l1', layanan_nama: 'Nama RPC', ikm: null, responden: null }], error: null } },
    });
    const hasil = await muatTransparansiPublik();
    expect(hasil.rows).toEqual([{ layanan_id: 'l1', layanan_nama: 'Nama RPC', ikm: null, responden: 0 }]);
  });

  it('daftar layanan gagal dibaca: { rows: [], galat: true } dan tidak disimpan; setelah pulih terbaca lagi', async () => {
    pasang({ from: { layanan: [galatDb] } });
    const gagal = await muatTransparansiPublik();
    expect(gagal).toMatchObject({ rows: [], galat: true });
    expect(h.memo.size).toBe(0);
    pasang({ from: { layanan: [{ data: layananDb, error: null }] }, rpc: { hitung_ikm: ikmRpc } });
    const pulih = await muatTransparansiPublik();
    expect(pulih.galat).toBe(false);
    expect(pulih.rows).toHaveLength(2);
    expect(h.memo.size).toBe(1);
  });

  it('daftar layanan kosong yang sah disimpan tanpa memanggil hitung_ikm', async () => {
    const { panggilanRpc } = pasang({ from: { layanan: [{ data: [], error: null }] } });
    const hasil = await muatTransparansiPublik();
    expect(hasil).toMatchObject({ rows: [], galat: false });
    expect(panggilanRpc).toHaveLength(0);
    expect(h.memo.size).toBe(1);
  });

  it('galat tak terduga (createClient melempar): bawaan aman + dicatat, tidak melempar', async () => {
    h.createClient.mockImplementation(() => {
      throw new Error('supabaseUrl is required');
    });
    const hasil = await muatTransparansiPublik();
    expect(hasil).toMatchObject({ rows: [], galat: true });
    expect(h.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'publik.transparansi_gagal' }));
    expect(h.memo.size).toBe(0);
  });

  it('tidak mengakses cookies() atau headers()', async () => {
    pasang({ from: { layanan: [{ data: layananDb, error: null }] }, rpc: { hitung_ikm: ikmRpc } });
    await muatTransparansiPublik();
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
  });
});
