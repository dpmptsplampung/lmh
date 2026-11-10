// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilKatalog from './ProfilKatalog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const id = '10000000-0000-4000-8000-000000000001';
const profil = {
  id, nama: 'Keripik Sari', deskripsi: 'Keripik pisang renyah', jenis: 'Produk', kategori: 'Makanan Olahan',
  spesifik: null, kabupaten_kota: 'Kota Bandar Lampung', kecamatan: 'Kedaton', instagram: null, tiktok: null,
  foto: [], suka: 3, dilihat: null, baru: false, telemetri_opsional_aktif: false, statistik_mulai_pada: null,
  bentuk_usaha: 'CV', tahun_mulai: 2015, skala: 'Mikro', omzet_label: 'Omzet lebih dari Rp50 juta per tahun',
  tenaga_kerja_rentang: '5-19',
  produk: [{
    urutan: 1, nama: 'Keripik pisang manis', keterangan: 'Kemasan 250 gram', kapasitas_jumlah: 1500,
    kapasitas_satuan: 'kg', kapasitas_periode: 'bulan', foto: { id: 'fp1', url: 'https://foto.example/keripik.jpg' },
  }],
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
let isi: Record<string, unknown>;
beforeEach(() => {
  isi = profil;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/serupa') ? ok({ items: [] })
    : url.endsWith('/suka') ? ok({ suka_saya: false }) : ok(isi)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('profil katalog: produk dan keterangan usaha', () => {
  it('profil menampilkan produk dengan kapasitas menurut UMKM', async () => {
    render(<ProfilKatalog id={id} />);
    const bagian = (await screen.findByRole('heading', { level: 2, name: 'Produk' })).closest('section')!;
    expect(within(bagian).getByText('Keripik pisang manis')).toBeTruthy();
    expect(within(bagian).getByText('Kemasan 250 gram')).toBeTruthy();
    expect(within(bagian).getByText('Kapasitas 1.500 kg per bulan (menurut UMKM)')).toBeTruthy();
    expect(within(bagian).getByRole('img', { name: /Keripik pisang manis/ })).toBeTruthy();
    expect(screen.getByText('Kedaton, Kota Bandar Lampung')).toBeTruthy();
  });

  it('profil menampilkan keterangan usaha yang terisi', async () => {
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: 'Keripik Sari' });
    expect(screen.getByText('Bentuk usaha: CV')).toBeTruthy();
    expect(screen.getByText('Mulai usaha: 2015')).toBeTruthy();
    expect(screen.getByText('Skala usaha: Mikro')).toBeTruthy();
    expect(screen.getByText('Omzet lebih dari Rp50 juta per tahun')).toBeTruthy();
    expect(screen.getByText('Tenaga kerja: 5 sampai 19 orang')).toBeTruthy();
  });

  it('profil tidak menampilkan baris yang kosong', async () => {
    isi = { ...profil, omzet_label: null, bentuk_usaha: null, tahun_mulai: null, skala: null,
      tenaga_kerja_rentang: null, kecamatan: null, produk: [] };
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: 'Keripik Sari' });
    expect(screen.queryByText(/Omzet/)).toBeNull();
    expect(screen.queryByText(/Bentuk usaha/)).toBeNull();
    expect(screen.queryByText(/Tenaga kerja/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Produk' })).toBeNull();
    expect(screen.getByText('Kota Bandar Lampung')).toBeTruthy();
  });

  it('profil dari server lama tanpa kolom baru tetap tampil', async () => {
    const { produk: _p, kecamatan: _k, omzet_label: _o, ...lama } = profil;
    void _p; void _k; void _o;
    isi = lama;
    render(<ProfilKatalog id={id} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Keripik Sari' })).toBeTruthy();
  });

  it('tidak membocorkan data tertutup', async () => {
    isi = { ...profil, nama_pemilik: 'Siti Rahma', alamat: 'Jl. Rahasia 1', omzet_rentang: '50_300jt' };
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: 'Keripik Sari' });
    expect(document.body.textContent).not.toMatch(/Siti Rahma|Jl\. Rahasia|50_300jt/);
  });
});
