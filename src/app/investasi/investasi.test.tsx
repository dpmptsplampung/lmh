// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestasiPublik, KartuPublik } from '@/lib/data/publik-server';
import type { AngkaInvestasiPublik } from '@/lib/data/investasi';
import type { DokumenPublik } from '@/lib/investasi/dokumen';

type DataHub = Omit<InvestasiPublik, 'dokumen'> & { dokumen: DokumenPublik[]; petaPotensi: DokumenPublik | null };
const h = vi.hoisted(() => ({
  data: null as unknown as DataHub,
  ringkasan: { angka: null, galat: false } as { angka: AngkaInvestasiPublik | null; galat: boolean },
}));
vi.mock('@/lib/data/publik-server', () => ({
  muatInvestasiPublik: async () => h.data,
  muatAngkaInvestasiPublik: async () => h.ringkasan,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null }, error: null }) } }) }));

import InvestasiPage, { metadata, revalidate } from './page';

const kartu = (n: number, sektor: string, kab_kota: string, tahap: string | null = null, sumber: 'ptsp' | 'foila' = 'ptsp'): KartuPublik => ({
  id: `p${n}`, sumber, slug: `proyek-${n}`, judul: `Proyek ${n}`, judul_en: null, ringkasan: `Ringkasan proyek ${n}.`, ringkasan_en: null,
  sektor, kab_kota, nilai_investasi: n * 1e9, mata_uang: 'IDR', nilai_teks: sumber === 'foila' ? 'IDR 2 trillion' : null, irr_persen: 10 + n,
  tahap_kajian: tahap, sumber_url: sumber === 'foila' ? `https://invest.lampungprov.go.id/p/${n}` : null, urutan: n, diterbitkan_pada: '2026-11-01T00:00:00Z',
  gambar: { url: `https://r2.example/${n}.webp`, url_mini: `https://r2.example/${n}-640.webp`, alt: `Foto proyek ${n}`, lebar: 800, tinggi: 500 },
});
const dok = (id: string, kategori: DokumenPublik['kategori'] = 'Kajian', jumlah = 12): DokumenPublik => ({
  id, judul: `Dokumen ${id}`, kategori, deskripsi: `Ringkasan ${id}.`, nilai_investasi: 'Rp 5 M', mata_uang: 'IDR', jumlah_halaman: jumlah,
  sampul: jumlah > 0 ? `/api/investment-docs/page-image?doc_id=${id}&page=1&varian=sampul` : null, urutan_tampil: 1, sorotan: kategori === 'Peta Potensi',
});
const lengkap = (): DataHub => ({
  ptsp: [kartu(1, 'energi', 'Kab. Pesawaran', 'fs'), kartu(2, 'pariwisata', 'Kab. Pesawaran'), kartu(3, 'energi', 'Kab. Lampung Selatan', 'ipro')],
  foila: [kartu(9, 'infrastruktur', 'Kota Bandar Lampung', null, 'foila'), kartu(10, 'energi', 'Kab. Pesawaran', null, 'foila')],
  dokumen: [dok('d1', 'Profil')],
  petaPotensi: null,
  sebaran: [
    { sektor: 'energi', kab_kota: 'Kab. Pesawaran', jumlah: 2 }, { sektor: 'energi', kab_kota: 'Kab. Lampung Selatan', jumlah: 1 },
    { sektor: 'pariwisata', kab_kota: 'Kab. Pesawaran', jumlah: 1 },
    { sektor: 'infrastruktur', kab_kota: 'Kota Bandar Lampung', jumlah: 1 },
  ],
  galat: false,
});
async function tampil() { render(await InvestasiPage()); }

beforeEach(() => { h.data = lengkap(); h.ringkasan = { angka: null, galat: false }; window.history.replaceState(null, '', '/investasi'); });
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

describe('hub /investasi', () => {
  it('ISR 60 detik, metadata statis dengan kanonik', () => {
    expect(revalidate).toBe(60);
    expect(metadata.title).toBe('Peluang Investasi Lampung');
    expect(metadata.openGraph?.siteName).toBe('Investment Gallery');
    expect(metadata.alternates?.canonical).toBe('/investasi');
    expect(String(metadata.description).length).toBeGreaterThan(40);
  });

  it('satu h1, urutan heading h1 > h2 (> h3 untuk kartu), tiap seksi bernama', async () => {
    await tampil();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Peluang Investasi Lampung' })).toBeInTheDocument();
    const urutan = screen.getAllByRole('heading').map(el => Number(el.tagName.slice(1)));
    for (let i = 1; i < urutan.length; i++) expect(urutan[i] - urutan[i - 1]).toBeLessThanOrEqual(1);
    for (const nama of [/Proyek siap ditawarkan/, 'Jelajah Proyek', 'Dari portal FOILA', 'Investment Gallery']) {
      expect(screen.getByRole('region', { name: nama })).toBeInTheDocument();
    }
    expect(document.getElementById('jelajah-proyek')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Peta Potensi Investasi' })).toBeNull();
  });

  it('kartu PTSP menaut ke detail; kartu FOILA hanya tautan keluar; dokumen maksimal 6 dengan tombol ke /gallery', async () => {
    h.data.dokumen = Array.from({ length: 8 }, (_, i) => dok(`${i}`, 'Lainnya', 3));
    await tampil();
    expect(screen.getByRole('link', { name: 'Proyek 1' })).toHaveAttribute('href', '/investasi/ipro/proyek-1');
    const foila = screen.getByRole('link', { name: /Proyek 9/ });
    expect(foila).toHaveAttribute('href', 'https://invest.lampungprov.go.id/p/9');
    expect(foila).toHaveAttribute('target', '_blank');
    const seksiDok = screen.getByRole('region', { name: 'Investment Gallery' });
    expect(within(seksiDok).getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(within(seksiDok).getByRole('link', { name: 'Lihat semua dokumen' })).toHaveAttribute('href', '/gallery');
  });

  it('saringan sektor menyaring daftar, mengumumkan jumlah, dan menulis hash URL; hapus saringan mengembalikan semua', async () => {
    await tampil();
    const seksi = screen.getByRole('region', { name: /Proyek siap ditawarkan/ });
    expect(within(seksi).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    act(() => { fireEvent.change(within(seksi).getByLabelText('Sektor'), { target: { value: 'energi' } }); });
    expect(within(seksi).getAllByRole('heading', { level: 3 }).map(x => x.textContent)).toEqual(['Proyek 1', 'Proyek 3']);
    expect(within(seksi).getByRole('status')).toHaveTextContent('Menampilkan 2 dari 3 proyek');
    expect(window.location.hash).toBe('#sektor=energi');
    act(() => { fireEvent.change(within(seksi).getByLabelText('Tahap kajian'), { target: { value: 'ipro' } }); });
    expect(within(seksi).getAllByRole('heading', { level: 3 }).map(x => x.textContent)).toEqual(['Proyek 3']);
    act(() => { fireEvent.click(within(seksi).getAllByRole('button', { name: 'Hapus saringan' })[0]); });
    expect(within(seksi).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(window.location.hash).toBe('');
  });

  it('hash awal diterapkan; kombinasi tanpa hasil menampilkan keadaan kosong dengan jalan keluar', async () => {
    window.history.replaceState(null, '', '/investasi#sektor=pariwisata&kab=Kab.%20Lampung%20Selatan');
    await tampil();
    const seksi = screen.getByRole('region', { name: /Proyek siap ditawarkan/ });
    expect(within(seksi).getByText('Tidak ada proyek yang cocok')).toBeInTheDocument();
    fireEvent.click(within(seksi).getAllByRole('button', { name: 'Hapus saringan' }).at(-1)!);
    expect(within(seksi).getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('Jelajah Proyek: kotak sektor menyaring daftar dan menandai aria-pressed; sektor tanpa proyek nonaktif', async () => {
    await tampil();
    const peta = screen.getByRole('region', { name: 'Jelajah Proyek' });
    // Hanya sektor berisi yang menjadi kotak; sektor kosong diringkas satu baris.
    expect(within(peta).queryByRole('button', { name: /Pertanian/ })).toBeNull();
    expect(within(peta).getByText(/sektor lain belum ada proyek/)).toBeInTheDocument();
    const energi = within(peta).getByRole('button', { name: /Energi/ });
    expect(energi).toHaveTextContent('2 proyek');
    act(() => { fireEvent.click(energi); });
    expect(energi).toHaveAttribute('aria-pressed', 'true');
    const seksi = screen.getByRole('region', { name: /Proyek siap ditawarkan/ });
    expect(within(seksi).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    act(() => { fireEvent.click(within(peta).getByRole('button', { name: /^Kab\. Pesawaran\s+2$/ })); });
    expect(within(seksi).getAllByRole('heading', { level: 3 }).map(x => x.textContent)).toEqual(['Proyek 1', 'Proyek 2']);
  });

  it('peta menghitung PTSP saja sesuai daftar tujuan, termasuk sektor/wilayah yang juga memiliki FOILA', async () => {
    await tampil();
    const peta = screen.getByRole('region', { name: 'Jelajah Proyek' });
    expect(within(peta).getByText(/Sebaran proyek IPRO PTSP/)).toBeInTheDocument();
    expect(within(peta).queryByRole('button', { name: /Infrastruktur/ })).toBeNull();
    expect(within(peta).queryByRole('button', { name: /Kota Bandar Lampung/ })).toBeNull();
    const daftar = screen.getByRole('region', { name: /Proyek siap ditawarkan/ });
    for (const nama of [/Energi/, /Pariwisata/, /^Kab\. Pesawaran\s+2$/, /^Kab\. Lampung Selatan\s+1$/]) {
      const tombol = within(peta).getByRole('button', { name: nama });
      const jumlah = Number(tombol.textContent!.match(/\d+/)![0]);
      fireEvent.click(tombol);
      expect(within(daftar).getAllByRole('heading', { level: 3 })).toHaveLength(jumlah);
    }
    expect(screen.getByRole('link', { name: /Proyek 9/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Proyek 10/ })).toBeInTheDocument();
  });

  it('tanpa proyek: keadaan kosong; galat sumber data menampilkan catatan galat tetapi halaman tetap tampil', async () => {
    h.data = { ...lengkap(), ptsp: [], foila: [], dokumen: [], sebaran: [], galat: true };
    await tampil();
    expect(screen.getByText('Belum ada proyek yang dipublikasikan')).toBeInTheDocument();
    expect(screen.getByText('Belum ada dokumen tersedia')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/belum dapat dimuat/);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kunjungi portal FOILA/ })).toHaveAttribute('href', 'https://invest.lampungprov.go.id/');
  });

  it('tanpa proyek: seksi Jelajah Proyek dan tombol lompat di hero tidak tampil', async () => {
    h.data = { ...lengkap(), ptsp: [], sebaran: [] };
    await tampil();
    expect(screen.queryByRole('region', { name: 'Jelajah Proyek' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Lihat .*proyek/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Jelajah Proyek' })).toBeNull();
  });

  it('navigasi: lompat ke isi, kepala dan kaki bernama', async () => {
    await tampil();
    expect(screen.getByRole('link', { name: 'Langsung ke isi' })).toHaveAttribute('href', '#isi-investasi');
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lampung Maju Hub, ke beranda' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Akun saya' })).toHaveAttribute('href', '/me');
    expect(screen.getByRole('link', { name: 'Investasi', current: 'page' })).toHaveAttribute('href', '/investasi');
    // Dokumen tetap terjangkau di semua ukuran dan satu landmark main milik root layout (bukan halaman ini).
    expect(within(screen.getByRole('navigation', { name: 'Navigasi utama' })).getByRole('link', { name: 'Investment Gallery' })).toHaveAttribute('href', '/gallery');
    expect(document.querySelectorAll('main')).toHaveLength(0);
    expect(screen.getAllByText('Investment Gallery').length).toBeGreaterThan(0);
  });

  it('hero: judul putih eksplisit (K1) dan angka ringkas dari loader tanpa total nilai', async () => {
    h.ringkasan = { angka: { jumlah_proyek: 5, jumlah_dokumen: 3, jumlah_sektor: 4, jumlah_wilayah: 0 }, galat: false };
    await tampil();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    const butir = within(hero).getAllByText(/proyek siap|dokumen dapat|sektor berisi|kabupaten/);
    expect(butir.map(b => b.textContent)).toEqual(['proyek siap ditawarkan', 'dokumen dapat dibaca daring', 'sektor berisi proyek']);
    expect(within(hero).getByText('5')).toBeInTheDocument();
    expect(hero.textContent).not.toMatch(/Rp|USD|total nilai/i);
    const css = readFileSync(join(process.cwd(), 'src/app/investasi/investasi.module.css'), 'utf8');
    expect(css).toMatch(/\.pahlawanJudul\s*\{[^}]*color:\s*var\(--color-neutral-0\)/);
  });

  it('hero: galat angka atau angka semuanya 0 menyembunyikan panel (tanpa mengklaim 0)', async () => {
    h.ringkasan = { angka: null, galat: true };
    await tampil();
    expect(document.querySelector('dl[data-jumlah]')).toBeNull();
    cleanup();
    h.ringkasan = { angka: { jumlah_proyek: 0, jumlah_dokumen: 0, jumlah_sektor: 0, jumlah_wilayah: 0 }, galat: false };
    await tampil();
    expect(document.querySelector('dl[data-jumlah]')).toBeNull();
  });

  it('sorotan Peta Potensi: tampil di atas daftar dengan aksi utama; tersembunyi bila tidak ada dokumen', async () => {
    h.data.petaPotensi = dok('peta1', 'Peta Potensi', 24);
    await tampil();
    const sorotan = screen.getByRole('region', { name: 'Dokumen peta1' });
    expect(sorotan).toHaveAttribute('id', 'peta-potensi');
    expect(within(sorotan).getByText('24 slide, dapat dibaca daring (hanya lihat)')).toBeInTheDocument();
    const urutan = screen.getAllByRole('region').map(r => r.id || r.getAttribute('aria-labelledby'));
    expect(urutan.indexOf('peta-potensi')).toBeLessThan(urutan.indexOf('proyek-ptsp'));
    fireEvent.click(within(sorotan).getByRole('button', { name: 'Buka Peta Potensi' }));
    expect(screen.getByRole('dialog', { name: 'Dokumen peta1' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByAltText('Dokumen peta1, slide 1 dari 24')).toBeInTheDocument();
    cleanup();
    h.data.petaPotensi = null;
    await tampil();
    expect(document.getElementById('peta-potensi')).toBeNull();
  });

  it('kartu dokumen: seluruh kartu membuka penampil, "Ajukan minat" membuka formulir, jumlah halaman 0 = diproses', async () => {
    h.data.dokumen = [dok('d1', 'Profil', 12), dok('d2', 'Kajian', 0)];
    await tampil();
    const seksi = screen.getByRole('region', { name: 'Investment Gallery' });
    expect(within(seksi).getByText('12 halaman')).toBeInTheDocument();
    expect(within(seksi).getByText('Sedang diproses')).toBeInTheDocument();
    fireEvent.click(within(seksi).getByRole('button', { name: /Dokumen d1, lihat dokumen/ }));
    expect(screen.getByRole('dialog', { name: 'Dokumen d1' })).toBeInTheDocument();
    cleanup();
    await tampil();
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan minat: Dokumen d1' }));
    expect(screen.getByRole('dialog', { name: 'Ajukan Minat Investasi' })).toBeInTheDocument();
  });

  it('kisi mengikuti jumlah kartu (tanpa kolom kosong) dan saringan HP dilipat di balik tombol', async () => {
    await tampil();
    expect(document.querySelector('ul[data-jumlah="3"]')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: 'Saring proyek' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    act(() => { fireEvent.change(screen.getByLabelText('Sektor'), { target: { value: 'energi' } }); });
    expect(screen.getByRole('button', { name: 'Saringan (1 aktif)' })).toBeInTheDocument();
  });
});
