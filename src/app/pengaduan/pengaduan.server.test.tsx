// @vitest-environment node
// /pengaduan sebagai Server Component (rencana 4.4): daftar layanan dimuat di server dan sudah ada di HTML awal,
// halaman tanpa 'use client' / sesi, formulir klien hanya menerima data biasa lewat props.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  muat: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  peramban: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: h.cookies, headers: h.headers }));
vi.mock('@/lib/data/publik-server', () => ({ muatOpsiLayananPengaduan: h.muat }));
// Klien PERAMBAN: tidak boleh tersentuh saat render server.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    h.peramban();
    return {};
  },
}));

import PengaduanPage, * as modulHalaman from './page';

const dir = join(process.cwd(), 'src/app/pengaduan');
const bersihkan = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SUMBER_HALAMAN = bersihkan(readFileSync(join(dir, 'page.tsx'), 'utf8'));
const SUMBER_FORM = readFileSync(join(dir, 'FormPengaduan.tsx'), 'utf8');

beforeEach(() => {
  h.muat.mockReset();
  h.cookies.mockReset();
  h.headers.mockReset();
  h.peramban.mockReset();
});

describe('/pengaduan: server component', () => {
  it('HTML awal sudah memuat opsi layanan dari server (urutan sama) di samping opsi umum', async () => {
    h.muat.mockResolvedValue({
      layanan: [
        { id: 'l1', nama: 'Bank Lampung' },
        { id: 'l2', nama: 'Konsultasi OSS' },
      ],
      galat: false,
    });
    const html = renderToString(await PengaduanPage());
    expect(html).toContain('Kanal Pengaduan');
    expect(html).toContain('Umum / tidak spesifik');
    const opsi = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(opsi).toEqual([
      ['', 'Umum / tidak spesifik'],
      ['l1', 'Bank Lampung'],
      ['l2', 'Konsultasi OSS'],
    ]);
    expect(h.muat).toHaveBeenCalledTimes(1);
  });

  it('galat/kosong memuat daftar: formulir tetap tampil dengan satu pilihan umum (tidak melempar)', async () => {
    h.muat.mockResolvedValue({ layanan: [], galat: true });
    const html = renderToString(await PengaduanPage());
    expect(html).toContain('Kirim Pengaduan');
    expect([...html.matchAll(/<option /g)]).toHaveLength(1);
  });

  it('keluaran server tidak memuat data pengguna: tanpa cookies()/headers() dan tanpa klien peramban', async () => {
    h.muat.mockResolvedValue({ layanan: [], galat: false });
    renderToString(await PengaduanPage());
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
    expect(h.peramban).not.toHaveBeenCalled();
  });

  it("page.tsx: tanpa 'use client', revalidate literal 60, tanpa akses sesi/DB langsung", () => {
    expect(SUMBER_HALAMAN).not.toMatch(/^\s*['"]use client['"]/m);
    expect(SUMBER_HALAMAN).toMatch(/export const revalidate = 60;/);
    expect((modulHalaman as { revalidate?: number }).revalidate).toBe(60);
    expect(SUMBER_HALAMAN).not.toMatch(/supabase\/(client|server|service)/);
    expect(SUMBER_HALAMAN).not.toMatch(/next\/headers|\bcookies\s*\(|\bheaders\s*\(/);
    expect(SUMBER_HALAMAN).not.toMatch(/\.(from|rpc)\(/);
    expect(SUMBER_HALAMAN).toMatch(/muatOpsiLayananPengaduan/);
  });

  it('FormPengaduan: komponen klien yang tidak membaca DB dan tidak mengimpor modul server-only', () => {
    expect(SUMBER_FORM).toMatch(/^\s*['"]use client['"]/m);
    expect(SUMBER_FORM).not.toMatch(/supabase\/(client|server|service)/);
    expect(SUMBER_FORM).not.toMatch(/publik-server|server-only/);
    expect(SUMBER_FORM).not.toMatch(/useEffect/);
  });

  it('page.tsx tidak mengoper komponen/fungsi sebagai props ke komponen klien (hanya data biasa)', () => {
    // Satu-satunya props ke FormPengaduan adalah `layanan` (array objek {id, nama}); ikon Tombol tidak dipakai di halaman.
    expect(SUMBER_HALAMAN).toMatch(/<FormPengaduan layanan=\{layanan\} \/>/);
    expect(SUMBER_HALAMAN).not.toMatch(/ikon=\{/);
  });
});
