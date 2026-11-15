// @vitest-environment node
// /transparansi sebagai Server Component (rencana 4.4): IKM kuartal berjalan dimuat di server lewat data publik
// ber-cache (klien anon; hitung_ikm dapat dieksekusi role anon) dan ikut di HTML awal; hanya grafik yang lazy di klien.
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
vi.mock('@/lib/data/publik-server', () => ({ muatTransparansiPublik: h.muat }));
// Klien PERAMBAN: tidak boleh tersentuh saat render server.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    h.peramban();
    return {};
  },
}));
// Grafik berat dimuat malas di klien (next/dynamic ssr:false); di sini diganti penanda yang memuat props yang diterima.
vi.mock('@/components/ui/grafik/dinamis', () => ({
  IkmPanelMalas: (props: { rows: unknown[]; periodLabel: string; mode: string }) => (
    <div data-testid="ikm" data-mode={props.mode} data-periode={props.periodLabel} data-rows={JSON.stringify(props.rows)} />
  ),
}));

import TransparansiPage, * as modulHalaman from './page';

const sumber = (nama: string) => readFileSync(join(process.cwd(), 'src/app/transparansi', nama), 'utf8');
const bersihkan = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SUMBER_HALAMAN = bersihkan(sumber('page.tsx'));

const rows = [
  { layanan_id: 'l1', layanan_nama: 'Bank Lampung', ikm: 82.5, responden: 12 },
  { layanan_id: 'l2', layanan_nama: 'Konsultasi OSS', ikm: null, responden: 0 },
];
const dataBaik = { rows, diperbaruiPada: '2026-11-11T03:30:00.000Z', galat: false };

const atribut = (html: string, nama: string) => {
  const m = html.match(new RegExp(`${nama}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
};

beforeEach(() => {
  h.muat.mockReset();
  h.cookies.mockReset();
  h.headers.mockReset();
  h.peramban.mockReset();
});

describe('/transparansi: server component', () => {
  it('HTML awal memuat judul, penjelasan, dan data IKM dari server (diteruskan ke panel sebagai data biasa)', async () => {
    h.muat.mockResolvedValue(dataBaik);
    const html = renderToString(await TransparansiPage());
    expect(html).toContain('Transparansi Layanan — IKM Publik');
    expect(html).toContain('Indeks Kepuasan Masyarakat (PermenPANRB 14/2017)');
    expect(html).toContain('Kembali ke Beranda');
    expect(html).not.toContain('role="alert"');
    expect(atribut(html, 'data-mode')).toBe('public');
    expect(atribut(html, 'data-periode')).toBe('Kuartal Ini');
    expect(JSON.parse(atribut(html, 'data-rows') as string)).toEqual(rows);
  });

  it('waktu pembaruan ditampilkan menurut WIB dari waktu data dihitung (bukan waktu peramban)', async () => {
    h.muat.mockResolvedValue(dataBaik); // 03:30 UTC = 10.30 WIB
    const html = renderToString(await TransparansiPage());
    expect(html).toMatch(/Diperbarui:\s*(<!-- -->)?\s*11 November 2026.*10[.:]30/);
  });

  it('daftar layanan gagal dimuat: pesan galat (role alert) + panel kosong, tanpa baris "Diperbarui"', async () => {
    h.muat.mockResolvedValue({ rows: [], diperbaruiPada: '2026-11-11T03:30:00.000Z', galat: true });
    const html = renderToString(await TransparansiPage());
    expect(html).toContain('role="alert"');
    expect(html).toContain('Gagal memuat data IKM. Coba lagi nanti.');
    expect(JSON.parse(atribut(html, 'data-rows') as string)).toEqual([]);
    expect(html).not.toContain('Diperbarui');
  });

  it('keluaran server tidak memuat data pengguna: tanpa cookies()/headers() dan tanpa klien peramban', async () => {
    h.muat.mockResolvedValue(dataBaik);
    renderToString(await TransparansiPage());
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
    expect(h.peramban).not.toHaveBeenCalled();
    expect(h.muat).toHaveBeenCalledTimes(1);
  });

  it("page.tsx: tanpa 'use client', revalidate literal 60, tanpa akses sesi/DB langsung, tanpa toISOString().split", () => {
    expect(SUMBER_HALAMAN).not.toMatch(/^\s*['"]use client['"]/m);
    expect(SUMBER_HALAMAN).toMatch(/export const revalidate = 60;/);
    expect((modulHalaman as { revalidate?: number }).revalidate).toBe(60);
    expect(SUMBER_HALAMAN).not.toMatch(/supabase\/(client|server|service)/);
    expect(SUMBER_HALAMAN).not.toMatch(/next\/headers|\bcookies\s*\(|\bheaders\s*\(/);
    expect(SUMBER_HALAMAN).not.toMatch(/\.(from|rpc)\(/);
    expect(SUMBER_HALAMAN).not.toMatch(/toISOString\(\)\s*\.split/);
    expect(SUMBER_HALAMAN).not.toMatch(/\buse(State|Effect|Callback|Memo)\b/);
    expect(SUMBER_HALAMAN).toMatch(/muatTransparansiPublik/);
  });

  it('panel grafik tetap lazy (IkmPanelMalas dari dinamis) dan satu-satunya props ke komponen klien adalah data biasa', () => {
    expect(SUMBER_HALAMAN).toMatch(/IkmPanelMalas/);
    expect(SUMBER_HALAMAN).toMatch(/<IkmPanel rows=\{[^}]+\} periodLabel="Kuartal Ini" mode="public" \/>/);
    expect(SUMBER_HALAMAN).not.toMatch(/ikon=\{/);
  });
});
