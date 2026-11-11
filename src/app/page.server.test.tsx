// @vitest-environment node
// Beranda sebagai Server Component (rencana 4.3): HTML awal sudah memuat daftar layanan dan konfigurasi blok,
// keluaran server tidak memuat data pengguna, dan alur data server memakai klien anon tanpa cookie.
// Memakai alur nyata page -> muatBerandaPublik -> pemuat lib/homepage/data, hanya Supabase/Next yang ditiru.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tabel: {} as Record<string, unknown>,
  /** Tabel yang dibalas galat SESAAT (mis. 503 / DB bermasalah). */
  galat: new Set<string>(),
  /** Tabel yang dibalas "objek belum ada" (Postgres 42P01: migrasi belum diterapkan). */
  belumAda: new Set<string>(),
  /** Tabel yang permintaannya tidak pernah kembali (jaringan/DB menggantung). */
  menggantung: new Set<string>(),
  anon: vi.fn(),
  peramban: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: h.cookies, headers: h.headers }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  unstable_rethrow: () => {},
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock('@/components/EstimasiAntrean', () => ({
  default: ({ judul }: { judul?: string }) => <section data-testid="estimasi">{judul}</section>,
}));
// Klien PERAMBAN (sesi pengguna): tidak boleh tersentuh saat render server.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    h.peramban();
    return { auth: { getUser: h.getUser } };
  },
}));
vi.mock('@/lib/sesi-staf', () => ({ keluarDariSesi: vi.fn() }));
// Klien ANON server (supabase-js): rantai query tiruan membaca h.tabel.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    h.anon(...args);
    return {
      from(nama: string) {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'eq', 'order', 'limit']) q[m] = () => q;
        q.then = (selesai: (v: unknown) => unknown, tolak: (e: unknown) => unknown) =>
          (h.menggantung.has(nama) ? new Promise<never>(() => {}) : Promise.resolve(
            h.belumAda.has(nama)
              ? { data: null, error: { message: 'relation does not exist', code: '42P01' } }
              : h.galat.has(nama)
                ? { data: null, error: { message: 'galat' } }
                : { data: h.tabel[nama] ?? [], error: null },
          )).then(selesai, tolak);
        return q;
      },
      rpc: () => Promise.resolve({ data: null, error: { message: 'tak dipakai di server' } }),
    };
  },
}));

import LandingPage, * as modulBeranda from './page';

const baris = (id: string, nama: string, urutan: number, o: Record<string, unknown> = {}) => ({
  id,
  nama,
  slug: nama.toLowerCase().replace(/\s+/g, '-'),
  deskripsi: `Deskripsi ${nama}`,
  urutan,
  instansi_nama: 'DPMPTSP',
  instansi_singkatan: null,
  website_terkait: [],
  status_tampilan: 'aktif',
  punya_antrean: true,
  punya_chat: true,
  tampil_di_homepage: true,
  ...o,
});

beforeEach(() => {
  h.galat.clear();
  h.belumAda.clear();
  h.menggantung.clear();
  h.anon.mockClear();
  h.peramban.mockClear();
  h.cookies.mockClear();
  h.headers.mockClear();
  h.getUser.mockClear();
  h.tabel = {
    v_layanan_publik: [
      baris('1', 'Helpdesk OSS', 1),
      baris('2', 'Bank Lampung', 2),
      baris('3', 'Tersembunyi', 3, { tampil_di_homepage: false }),
    ],
    homepage_blok: [],
    site_settings: [
      { key: 'wa_number', value: '081211112222' },
      { key: 'contact_address', value: 'Jl. Pengaturan Server 9' },
    ],
  };
});

const htmlAwal = async () => renderToString(await LandingPage());

describe('beranda sebagai Server Component', () => {
  it('berkas page.tsx tanpa "use client", revalidate = 60 (literal), dan tanpa props fungsi/ikon ke komponen klien', () => {
    const sumber = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    expect(sumber).not.toMatch(/^\s*['"]use client['"]/m);
    expect(modulBeranda.revalidate).toBe(60);
    expect(sumber).toMatch(/export const revalidate = 60;/);
    const kode = sumber.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Fungsi dan komponen ikon tidak bisa melewati batas server-klien (build gagal): hanya data biasa.
    expect(kode).not.toMatch(/\bon[A-Z][A-Za-z]*\s*=/);
    expect(kode).not.toMatch(/\bikon\s*=/);
    expect(kode).not.toMatch(/\b(useState|useEffect|useRef|useRouter|createClient)\b/);
  });

  it('HTML awal sudah memuat daftar layanan (kartu) tanpa menunggu klien', async () => {
    const html = await htmlAwal();
    expect(html).toContain('Helpdesk OSS');
    expect(html).toContain('Bank Lampung');
    expect(html).toContain('2 Layanan dalam Satu Atap');
    expect((html.match(/<article/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Tersembunyi'); // tampil_di_homepage=false: tanpa kartu
    expect(html).not.toContain('Memuat halaman');
  });

  it('HTML awal memuat blok bawaan, tautan navigasi, dan tautan Kebijakan Privasi', async () => {
    const html = await htmlAwal();
    expect(html).toContain('Lampung Maju');
    expect(html).toContain('data-testid="estimasi"');
    expect(html).toContain('href="#layanan"');
    expect(html).toContain('href="/kebijakan-privasi"');
    expect(html).toContain('href="/chat"');
  });

  it('pengaturan situs dibaca server: tautan WhatsApp hero dan alamat footer', async () => {
    const html = await htmlAwal();
    expect(html).toContain('https://wa.me/6281211112222');
    expect(html).toContain('Jl. Pengaturan Server 9');
  });

  it('keluaran server tidak memuat data pengguna: hanya keadaan belum masuk', async () => {
    const html = await htmlAwal();
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('Panel Admin');
    expect(html).not.toContain('Dashboard Saya');
    expect(html).not.toContain('Keluar');
    expect(h.peramban).not.toHaveBeenCalled(); // klien peramban (sesi) tidak dibuat saat render server
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
  });

  it('data server memakai klien anon tanpa sesi (persistSession=false)', async () => {
    await htmlAwal();
    expect(h.anon).toHaveBeenCalled();
    for (const [, , opsi] of h.anon.mock.calls) {
      expect(opsi.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    }
  });

  it('blok yang dimatikan admin tidak ada di HTML awal; tautan menu "Layanan" ikut hilang', async () => {
    h.tabel.homepage_blok = [
      { jenis: 'ajakan', aktif: false, urutan: 60, teks: {} },
      { jenis: 'layanan', aktif: false, urutan: 40, teks: {} },
    ];
    const html = await htmlAwal();
    expect(html).not.toContain('id="layanan"');
    expect(html).not.toContain('href="#layanan"');
    expect(html).not.toContain('Siap Berkunjung?');
    expect(html).toContain('Lampung Maju');
  });

  it('semua kueri layanan gagal: HTML awal memuat galat + Coba lagi (bukan "sedang disiapkan")', async () => {
    h.galat.add('v_layanan_publik');
    const html = await htmlAwal();
    expect(html).toContain('Daftar layanan belum dapat dimuat');
    expect(html).toContain('Coba lagi');
    expect(html).not.toContain('sedang disiapkan');
    expect(html).toContain('Lampung Maju'); // halaman tetap tampil dengan blok
  });

  it('daftar kosong yang sah: keterangan "sedang disiapkan", bukan galat', async () => {
    h.tabel.v_layanan_publik = [];
    const html = await htmlAwal();
    expect(html).toContain('sedang disiapkan');
    expect(html).not.toContain('belum dapat dimuat');
  });

  it('tabel homepage_blok belum ada (migrasi belum diterapkan): beranda tetap tampil dengan blok bawaan', async () => {
    h.belumAda.add('homepage_blok');
    const html = await htmlAwal();
    expect(html).toContain('Lampung Maju');
    expect(html).toContain('2 Layanan dalam Satu Atap');
  });

  it('galat sesaat pada homepage_blok (503): beranda tetap tampil dengan blok bawaan untuk sekali ini', async () => {
    h.galat.add('homepage_blok');
    const html = await htmlAwal();
    expect(html).toContain('Lampung Maju');
    expect(html).toContain('2 Layanan dalam Satu Atap');
  });

  it('permintaan menggantung: HTML awal tetap terbit setelah 6 detik, dengan galat daftar + Coba lagi', async () => {
    h.menggantung.add('v_layanan_publik');
    h.menggantung.add('homepage_blok');
    h.menggantung.add('site_settings');
    vi.useFakeTimers();
    try {
      let selesai = false;
      const janji = htmlAwal().then((html) => {
        selesai = true;
        return html;
      });
      await vi.advanceTimersByTimeAsync(5900);
      expect(selesai).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      const html = await janji;
      expect(html).toContain('Daftar layanan belum dapat dimuat');
      expect(html).toContain('Lampung Maju');
    } finally {
      vi.useRealTimers();
    }
  });
});
