// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DokumenPublik } from '@/lib/investasi/dokumen';

type Galeri = { dokumen: DokumenPublik[]; adaBerikutnya: boolean; galat: boolean };
const h = vi.hoisted(() => ({
  galeri: null as unknown as Galeri,
  peta: null as unknown as DokumenPublik | null,
  halaman: [] as number[],
}));
vi.mock('@/lib/data/publik-server', () => ({
  muatGaleriPublik: async (halaman: number) => { h.halaman.push(halaman); return h.galeri; },
  muatInvestasiPublik: async () => ({ petaPotensi: h.peta }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null }, error: null }) } }) }));

import GalleryPage, { metadata } from './page';
import MemuatGallery from './loading';
import GalatGallery from './error';
import { nomorHalaman, pisahSorotan } from './_logika/galeri';

const dok = (id: string, kategori: DokumenPublik['kategori'] = 'Kajian', jumlah = 12): DokumenPublik => ({
  id, judul: `Dokumen ${id}`, kategori, deskripsi: `Ringkasan ${id}.`, nilai_investasi: 'Rp 5 M', mata_uang: 'IDR', jumlah_halaman: jumlah,
  sampul: jumlah > 0 ? `/api/investment-docs/page-image?doc_id=${id}&page=1&varian=sampul` : null, urutan_tampil: 1, sorotan: kategori === 'Peta Potensi',
});
async function tampil(halaman?: string) { return render(await GalleryPage({ searchParams: Promise.resolve(halaman ? { halaman } : {}) })); }

beforeEach(() => {
  h.galeri = { dokumen: [dok('a'), dok('b', 'Profil'), dok('c', 'Lainnya', 0)], adaBerikutnya: false, galat: false };
  h.peta = null;
  h.halaman = [];
});
afterEach(cleanup);

describe('/gallery (Server Component)', () => {
  it('nama tunggal Investment Gallery di judul, h1, metadata, remah roti, dan nav Investment Gallery aktif', async () => {
    await tampil();
    expect(metadata.title).toBe('Investment Gallery');
    expect(metadata.openGraph?.siteName).toBe('Investment Gallery');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Investment Gallery' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Remah roti' })).getByText('Investment Gallery')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Investment Gallery', current: 'page' })).toHaveAttribute('href', '/gallery');
    expect(document.querySelectorAll('main')).toHaveLength(0);
  });

  it('tanpa style inline, tanpa tema gelap: dibungkus kerangka investasi (kepala dan kaki)', async () => {
    const { container } = await tampil();
    // Satu-satunya style= yang sah ada di logo (disisipkan next/image), bukan di halaman ini.
    expect([...container.querySelectorAll('[style]')].filter(el => !el.matches('img[src*="logo"]'))).toEqual([]);
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Tautan kaki halaman' })).toBeInTheDocument();
  });

  it('kartu dokumen: seluruh kartu membuka penampil; aksi minat sekunder; jumlah halaman 0 = diproses', async () => {
    await tampil();
    const daftar = screen.getByRole('list', { name: 'Daftar dokumen investasi' });
    expect(daftar).toHaveAttribute('data-jumlah', '3');
    expect(within(daftar).getAllByText('12 halaman')).toHaveLength(2);
    expect(within(daftar).getByText('Sedang diproses')).toBeInTheDocument();
    const sampul = daftar.querySelector('img') as HTMLImageElement;
    expect(sampul.getAttribute('src')).toBe('/api/investment-docs/page-image?doc_id=a&page=1&varian=sampul');
    expect(sampul).toHaveAttribute('loading', 'lazy');
    fireEvent.click(within(daftar).getByRole('button', { name: /Dokumen a, lihat dokumen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Dokumen a' });
    expect(within(dialog).getByAltText('Dokumen a, halaman 1 dari 12')).toBeInTheDocument();
    // Dokumen belum siap: keadaan yang sama di mana pun (penampil memberi tahu, bukan memuat 24 halaman).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup penampil dokumen' }));
    fireEvent.click(within(daftar).getByRole('button', { name: /Dokumen c, lihat dokumen/ }));
    expect(within(screen.getByRole('dialog')).getByText('Dokumen ini sedang diproses.')).toBeInTheDocument();
  });

  it('"Ajukan minat" membuka formulir kanal dokumen untuk dokumen yang dipilih; dari penampil juga bisa', async () => {
    await tampil();
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan minat: Dokumen b' }));
    const dialog = screen.getByRole('dialog', { name: 'Ajukan Minat Investasi' });
    expect(within(dialog).getByText('Dokumen b')).toBeInTheDocument();
    cleanup();
    await tampil();
    fireEvent.click(screen.getByRole('button', { name: /Dokumen a, lihat dokumen/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Dokumen a' })).getByRole('button', { name: 'Ajukan minat' }));
    expect(screen.getByRole('dialog', { name: 'Ajukan Minat Investasi' })).toBeInTheDocument();
  });

  it('sorotan Peta Potensi di atas daftar dan tidak muncul dua kali; kotak FOILA diganti satu baris tautan', async () => {
    h.peta = dok('peta', 'Peta Potensi', 24);
    h.galeri.dokumen = [dok('a'), dok('peta', 'Peta Potensi', 24)];
    await tampil();
    const sorotan = screen.getByRole('region', { name: 'Dokumen peta' });
    expect(within(sorotan).getByRole('button', { name: 'Buka Peta Potensi' })).toBeInTheDocument();
    const daftar = screen.getByRole('list', { name: 'Daftar dokumen investasi' });
    expect(within(daftar).queryByText('Dokumen peta')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Dokumen lainnya' })).toBeInTheDocument();
    expect(sorotan.compareDocumentPosition(daftar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Portal FOILA')).toBeNull();
    expect(screen.getByRole('link', { name: /Kunjungi portal FOILA/ })).toHaveAttribute('href', 'https://invest.lampungprov.go.id/');
  });

  it('tanpa dokumen Peta Potensi: tidak ada sorotan dan tidak ada kartu yang diam saat diklik', async () => {
    await tampil();
    expect(document.getElementById('peta-potensi')).toBeNull();
    expect(screen.queryByRole('button', { name: /Buka Peta Potensi/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Semua dokumen' })).toBeInTheDocument();
  });

  it('galat muat dibedakan dari katalog kosong', async () => {
    h.galeri = { dokumen: [], adaBerikutnya: false, galat: true };
    await tampil();
    expect(screen.getByRole('alert')).toHaveTextContent(/belum dapat dimuat/);
    expect(screen.getByRole('link', { name: 'Muat ulang' })).toHaveAttribute('href', '/gallery');
    expect(screen.queryByText('Belum ada dokumen tersedia')).toBeNull();
    cleanup();
    h.galeri = { dokumen: [], adaBerikutnya: false, galat: false };
    await tampil();
    expect(screen.getByText('Belum ada dokumen tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('paginasi dari ?halaman=: kontrol lanjutan hanya bila ada halaman berikutnya; halaman di luar rentang punya jalan keluar', async () => {
    h.galeri.adaBerikutnya = true;
    await tampil();
    expect(h.halaman).toEqual([1]);
    const nav = screen.getByRole('navigation', { name: 'Halaman daftar dokumen' });
    expect(within(nav).getByRole('link', { name: 'Berikutnya' })).toHaveAttribute('href', '/gallery?halaman=2');
    expect(within(nav).queryByRole('link', { name: 'Sebelumnya' })).toBeNull();
    cleanup();
    await tampil('2');
    expect(h.halaman.at(-1)).toBe(2);
    const nav2 = screen.getByRole('navigation', { name: 'Halaman daftar dokumen' });
    expect(within(nav2).getByRole('link', { name: 'Sebelumnya' })).toHaveAttribute('href', '/gallery');
    expect(within(nav2).getByText('Halaman 2')).toBeInTheDocument();
    cleanup();
    h.galeri = { dokumen: [], adaBerikutnya: false, galat: false };
    await tampil('99');
    expect(screen.getByText('Tidak ada dokumen di halaman ini')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ke halaman pertama' })).toHaveAttribute('href', '/gallery');
  });

  it('keadaan memuat dan galat tak terduga tetap dalam kerangka', () => {
    const { unmount } = render(<MemuatGallery />);
    expect(screen.getByText('Memuat dokumen investasi')).toBeInTheDocument();
    unmount();
    const reset = vi.fn();
    render(<GalatGallery error={new Error('x')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
  });
});

describe('logika galeri', () => {
  it('nomorHalaman: bilangan bulat positif, selain itu 1', () => {
    expect(nomorHalaman(undefined)).toBe(1);
    expect(nomorHalaman('3')).toBe(3);
    expect(nomorHalaman(['4', '5'])).toBe(4);
    for (const buruk of ['0', '-1', 'abc', '1.5', '', '9999999999']) expect(nomorHalaman(buruk)).toBe(1);
  });
  it('pisahSorotan: halaman lanjutan tanpa sorotan; cadangan dari dokumen bertanda sorotan', () => {
    const peta = dok('p', 'Peta Potensi');
    expect(pisahSorotan([dok('a'), peta], null, false)).toEqual({ sorotan: null, sisa: [dok('a'), peta] });
    expect(pisahSorotan([dok('a'), peta], null, true).sorotan?.id).toBe('p');
    expect(pisahSorotan([dok('a')], null, true)).toEqual({ sorotan: null, sisa: [dok('a')] });
  });
});
