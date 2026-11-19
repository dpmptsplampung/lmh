// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailIproPublik } from '@/lib/data/publik-server';

const h = vi.hoisted(() => ({
  ipro: null as DetailIproPublik | null,
  galat: false,
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/data/publik-server', () => ({
  muatIproPublik: async () => { if (h.galat) throw new Error('galat'); return h.ipro; },
  muatInvestasiPublik: () => { throw new Error('Detail tidak boleh bergantung pada daftar 12 dokumen di hub'); },
}));
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));

import DetailIproPage, { generateMetadata, generateStaticParams, revalidate } from './page';
import GalatDetailIpro from './error';

const gambar = (n: number, utama = false) => ({
  id: `g${n}`, proyek_id: 'p1', utama, urutan: n, lebar: 1200, tinggi: 800, alt: `Foto ${n}`, alt_en: null,
  keterangan: null, keterangan_en: null, url: `https://r2.example/${n}.webp`, url_mini: `https://r2.example/${n}-640.webp`,
});
const dasar = (): DetailIproPublik => ({
  id: '20000000-0000-4000-8000-000000000001', sumber: 'ptsp', slug: 'wisata-pesisir', judul: 'Kawasan Wisata Pesisir', judul_en: null,
  ringkasan: 'Pengembangan kawasan wisata bahari terpadu di pesisir Pesawaran.', ringkasan_en: null, sektor: 'pariwisata', kab_kota: 'Kab. Pesawaran',
  nilai_investasi: 1_200_000_000_000, mata_uang: 'IDR', nilai_teks: null, irr_persen: 14.5, tahap_kajian: 'fs', sumber_url: null, urutan: 0,
  diterbitkan_pada: '2026-11-01T00:00:00Z', deskripsi: 'Paragraf satu <b>tebal</b>.\n\nParagraf dua.', deskripsi_en: null, lokasi_teks: 'Teluk Ratai',
  lat: null, lng: null, pemilik: 'Pemkab Pesawaran', npv_nilai: 300_000_000_000, payback_bulan: 90, skema: 'kpbu', status_lahan: 'milik_pemda',
  luas_ha: 45, perizinan: 'Izin lokasi terbit', dokumen_id: 'dok-1', kontak_instansi: 'Dinas Pariwisata', kontak_email: 'dinas@contoh.go.id',
  dokumen: { id: 'dok-1', judul: 'Kajian Pesisir', jumlah_halaman: 4 },
  kontak_telepon: '0721 123 456', diubah_pada: '2026-11-18T10:00:00Z', gambar: [gambar(1, true), gambar(2), gambar(3)],
});

beforeEach(() => {
  h.ipro = dasar(); h.galat = false;
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: 'anon' } } }, error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const props = (slug = 'wisata-pesisir') => ({ params: Promise.resolve({ slug }) });
async function tampil(slug?: string) { render(await DetailIproPage(props(slug))); }

describe('detail IPRO: perutean', () => {
  it('ISR 60 dan generateStaticParams kosong (halaman dirender saat diminta)', async () => {
    expect(revalidate).toBe(60);
    expect(await generateStaticParams()).toEqual([]);
  });

  it('slug tak terbit/bukan PTSP (loader mengembalikan null) = notFound (404)', async () => {
    h.ipro = null;
    await expect(DetailIproPage(props('tidak-ada'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('galat sesaat loader dilempar (error boundary), bukan 404', async () => {
    h.galat = true;
    await expect(DetailIproPage(props())).rejects.toThrow('galat');
  });
});

describe('detail IPRO: generateMetadata', () => {
  it('judul, deskripsi ringkas ≤160, kanonik, dan gambar utama untuk Open Graph', async () => {
    const meta = await generateMetadata(props());
    expect(meta.title).toBe('Kawasan Wisata Pesisir');
    expect(String(meta.description).length).toBeLessThanOrEqual(160);
    expect(meta.alternates?.canonical).toContain('/investasi/ipro/wisata-pesisir');
    expect(meta.openGraph?.images).toEqual([{ url: 'https://r2.example/1.webp', width: 1200, height: 800, alt: 'Foto 1' }]);
  });
  it('slug tak ada: tidak diindeks; galat: metadata generik tanpa melempar', async () => {
    h.ipro = null;
    expect((await generateMetadata(props('x'))).robots).toMatchObject({ index: false });
    h.galat = true;
    expect((await generateMetadata(props('x'))).title).toBe('Proyek investasi');
  });
});

describe('detail IPRO: isi dan a11y', () => {
  it('satu h1 judul, h2 bernama, remah roti ke hub, angka kunci, deskripsi sebagai teks, tabel fakta bercaption, galeri', async () => {
    await tampil();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kawasan Wisata Pesisir');
    const urutan = screen.getAllByRole('heading').map(el => Number(el.tagName.slice(1)));
    for (let i = 1; i < urutan.length; i++) expect(urutan[i] - urutan[i - 1]).toBeLessThanOrEqual(1);
    const remah = screen.getByRole('navigation', { name: 'Remah roti' });
    expect(within(remah).getByRole('link', { name: 'Investasi' })).toHaveAttribute('href', '/investasi');
    expect(within(remah).getByText('Kawasan Wisata Pesisir')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Rp 1,2 T')).toBeInTheDocument();
    expect(screen.getByText('7 tahun 6 bulan')).toBeInTheDocument();
    // deskripsi dirender sebagai teks (tidak ada elemen <b> dari data)
    expect(screen.getByText('Paragraf satu <b>tebal</b>.')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('Paragraf dua.')).toBeInTheDocument();
    const tabel = screen.getByRole('table', { name: 'Fakta proyek' });
    expect(within(tabel).getByRole('rowheader', { name: 'Pemilik/pemrakarsa' })).toBeInTheDocument();
    expect(within(tabel).getByText('KPBU')).toBeInTheDocument();
    expect(within(tabel).getByText('Milik pemerintah daerah')).toBeInTheDocument();
    expect(within(tabel).getByText('Izin lokasi terbit')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Foto proyek' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Perbesar foto/ })).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Foto 1' })).toBeInTheDocument();
  });

  it('kontak hanya lembaga; tanpa data kontak, kartu tidak ada; FOILA/PTSP tanpa nomor pribadi', async () => {
    await tampil();
    const kontak = screen.getByRole('region', { name: 'Kontak lembaga' });
    expect(within(kontak).getByText('Dinas Pariwisata')).toBeInTheDocument();
    expect(within(kontak).getByRole('link', { name: 'dinas@contoh.go.id' })).toHaveAttribute('href', 'mailto:dinas@contoh.go.id');
    expect(within(kontak).getByRole('link', { name: '0721 123 456' })).toHaveAttribute('href', 'tel:0721123456');
    cleanup();
    h.ipro = { ...dasar(), kontak_instansi: null, kontak_email: null, kontak_telepon: null, gambar: [gambar(1, true)], npv_nilai: null, skema: null, perizinan: null };
    await tampil();
    expect(screen.queryByRole('region', { name: 'Kontak lembaga' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Foto proyek' })).toBeNull();
    expect(screen.queryByText('NPV')).toBeNull();
  });

  it('proyek tanpa foto dan tanpa deskripsi tetap tampil utuh (tanpa seksi kosong)', async () => {
    h.ipro = { ...dasar(), gambar: [], deskripsi: null };
    await tampil();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tentang proyek' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('JSON-LD (bila basis URL ada) hanya BreadcrumbList dan di-escape; tanpa script lain', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_URL', 'https://lmh.example');
    h.ipro = { ...dasar(), judul: 'Judul </script><script>x</script>' };
    const { default: Halaman } = await import('./page');
    render(await Halaman(props()));
    const skrip = document.querySelectorAll('script[type="application/ld+json"]');
    expect(skrip).toHaveLength(1);
    const mentah = skrip[0].innerHTML;
    expect(mentah).not.toContain('</script>');
    const ld = JSON.parse(mentah);
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement[1].item).toBe('https://lmh.example/investasi/ipro/wisata-pesisir');
    expect(mentah).not.toMatch(/dinas@contoh|0721/);
    vi.unstubAllEnvs();
  });
});

describe('detail IPRO: aksi', () => {
  it('"Hubungi petugas" membuka formulir dengan konteks proyek; Escape menutup dan fokus kembali', async () => {
    await tampil();
    const pemicu = screen.getByRole('button', { name: 'Hubungi petugas' });
    pemicu.focus();
    fireEvent.click(pemicu);
    const dialog = screen.getByRole('dialog', { name: 'Hubungi petugas' });
    expect(within(dialog).getByText('Kawasan Wisata Pesisir')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });

  it('kirim dari halaman detail memanggil /api/investasi/pesan dengan ipro_id proyek', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: { id: '30000000-0000-4000-8000-000000000001' } }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    await tampil();
    fireEvent.click(screen.getByRole('button', { name: 'Hubungi petugas' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Nama/), { target: { value: 'Sari' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'sari@contoh.id' } });
    fireEvent.change(within(dialog).getByLabelText(/^Pesan/), { target: { value: 'Mohon rincian kajian proyek.' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(within(dialog).getByRole('status')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/investasi/pesan', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ ipro_id: '20000000-0000-4000-8000-000000000001', setuju_pdp: true });
  });

  it('"Lihat dokumen kajian" membuka penampil view-only bila dokumen aktif; tanpa dokumen aktif tombolnya tidak ada', async () => {
    await tampil();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat dokumen kajian' }));
    const dialog = screen.getByRole('dialog', { name: 'Kajian Pesisir' });
    expect(within(dialog).getByAltText('Halaman 1 dari 4')).toBeInTheDocument();
    cleanup();
    h.ipro!.dokumen = null;
    await tampil();
    expect(screen.queryByRole('button', { name: 'Lihat dokumen kajian' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hubungi petugas' })).toBeInTheDocument();
  });
});

describe('detail IPRO: error boundary', () => {
  it('pesan ramah dengan tautan kembali dan tombol Coba lagi', () => {
    const reset = vi.fn();
    render(<GalatDetailIpro error={new Error('x')} reset={reset} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Proyek belum dapat dimuat' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'peluang investasi' })).toHaveAttribute('href', '/investasi');
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
