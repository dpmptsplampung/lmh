// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TugasUmkm from './TugasUmkm';

const pid = '10000000-0000-4000-8000-000000000001';
const rid = '20000000-0000-4000-8000-000000000009';
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
let fetchMock: ReturnType<typeof vi.fn>;
let kodeTautan: string | null;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  kodeTautan = 'ABCDEFGHJKMN';
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return ok({ id: rid, kebutuhan_id: 'k', kode: 'UM-WXYZ', status: 'diajukan',
      versi: 1, kode_tautan: kodeTautan });
    if (url.includes('/cari?')) return ok({ items: [
      { id: pid, jenis: 'profil', nama: 'Kopi Lampung', status: 'terbit' },
      { id: 'lain', jenis: 'profil', nama: 'Kopi Tersembunyi', status: 'disembunyikan' }], next_cursor: null });
    if (url.endsWith(`/permintaan/${rid}`)) return ok({
      id: rid, jenis: 'permintaan', nama: 'Permintaan kontak', profil_id: pid, profil_nama: 'Kopi Lampung',
      status: 'diajukan', versi: 1, mendesak: false, petugas_id: 's', petugas_nama: 'Sari',
      dibuat_pada: '2026-11-09T02:00:00Z', kode: 'UM-WXYZ', pemeriksa_nama: 'Sari', profil_versi: 1,
      kebutuhan: { id: 'k', teks: 'Kopi 50 kg', kategori: 'Minuman', kabupaten_kota: null, status: 'aktif' },
      perusahaan: { id: 'p', nama: 'PT Maju', jabatan: 'Pembeli', diperiksa: false },
      pemohon: { nama: 'Rina', hp: '081300002222', email: null }, tertaut: false, dipegang_saya: true,
      izin_ada: false, kontak_ada: true, pembukaan: null, alasan_tolak: null,
    });
    return ok({ items: [], next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

const isi = async () => {
  render(<TugasUmkm />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bantu pemohon' }));
  const set = (nama: RegExp | string, nilai: string) =>
    fireEvent.change(screen.getByRole('textbox', { name: nama }), { target: { value: nilai } });
  set(/Nama perusahaan/, 'PT Maju'); set(/Jabatan pemohon/, 'Pembeli'); set(/Nama pemohon/, 'Rina');
  set(/Nomor HP pemohon/, '081300002222'); set(/Kebutuhan/, 'Kopi 50 kg'); set(/^Kategori/, 'Minuman');
  fireEvent.change(screen.getByRole('searchbox', { name: /Cari nama UMKM/ }), { target: { value: 'kopi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cari UMKM' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pilih Kopi Lampung' }));
  fireEvent.click(screen.getByRole('button', { name: 'Catat permintaan' }));
};

describe('bantuan tanpa akun (butir 3)', () => {
  it('hanya profil terbit dapat dipilih dan isian dikirim apa adanya ke rute bantu', async () => {
    await isi();
    await screen.findByRole('heading', { name: 'Permintaan bantuan dicatat' });
    expect(screen.queryByRole('button', { name: 'Pilih Kopi Tersembunyi' })).toBeNull();
    const [url, init] = posts()[0];
    expect(url).toBe('/api/admin/umkm-tugas/permintaan/bantu');
    expect(JSON.parse(init.body)).toMatchObject({ nama_perusahaan: 'PT Maju', jabatan: 'Pembeli',
      nama_pemohon: 'Rina', kontak: '081300002222', teks: 'Kopi 50 kg', kategori: 'Minuman',
      kabupaten_kota: null, profil_id: pid });
  });

  it('kode tampil sekali 4-4-4 dengan salin, tidak masuk penyimpanan, hilang setelah ditutup', async () => {
    await isi();
    expect(await screen.findByLabelText('Kode tautan')).toHaveTextContent('ABCD-EFGH-JKMN');
    const pesan = screen.getByText(/Halo Rina, saya Sari/);
    expect(pesan.textContent).toContain('Halo Rina, saya Sari');
    fireEvent.click(screen.getByRole('button', { name: 'Salin kode' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN'));
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain('ABCD');
    expect(window.location.href).not.toContain('ABCD');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup dan buka permintaan' }));
    await waitFor(() => expect(screen.queryByLabelText('Kode tautan')).toBeNull());
    expect(document.body.textContent).not.toContain('ABCD-EFGH-JKMN');
  });

  it('balasan ulang tanpa kode menjelaskan kode tidak tersedia lagi', async () => {
    kodeTautan = null;
    await isi();
    expect(await screen.findByText(/Kode tautan tidak tersedia lagi/)).toBeTruthy();
    expect(screen.queryByLabelText('Kode tautan')).toBeNull();
  });
});
