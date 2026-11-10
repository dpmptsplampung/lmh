// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail } from '@/lib/umkm-katalog/types';
import DetailTugas from './DetailTugas';
import ProfilForm from './ProfilForm';

const pid = '10000000-0000-4000-8000-000000000001';
const oid = '40000000-0000-4000-8000-000000000001';
const detail = {
  id: pid, jenis: 'profil', nama: 'Kopi Lampung', status: 'diterbitkan', versi: 3, mendesak: false,
  dibuat_pada: '2026-11-09T02:00:00Z', petugas_id: 'staf', petugas_nama: 'Sari', tanpa_nomor: false,
  peringatan_kontak: [], dipegang_saya: false, sumber: 'kurasi', sumber_ref: null,
  revisi: {
    id: 'r', profil_id: pid, versi: 1, nama: 'Kopi Lampung', deskripsi: 'Kopi', alamat: null, jenis: 'Produk',
    kategori: 'Minuman Olahan', spesifik: null, kabupaten_kota: 'Kab. Lampung Barat', memiliki_nib: null, instagram: null,
    tiktok: null, dibuat_pada: '2026-11-09T02:00:00Z', keputusan: 'terbit',
  },
  foto: [], izin_status: null, pemilik: null,
  pemilik_terdaftar: [{ id: oid, nama: 'Budi Santoso', versi: 4 }],
} as unknown as Detail;
let fetchMock: ReturnType<typeof vi.fn>;
const props = () => ({ onChanged: vi.fn(), onEdit: vi.fn(), onBack: vi.fn(), onRefresh: vi.fn() });
const tampil = (d: Detail, p = props()) => {
  render(<DetailTugas detail={d as Parameters<typeof DetailTugas>[0]['detail']} {...p} />); return p;
};
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code, message: 'x' }, request_id: 'r' }), { status }));

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
    data: { id: oid, jenis: 'klaim', profil_id: pid, status: 'ditolak', versi: 5 }, meta: { request_id: 'r' },
  }))));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('cabut kepemilikan (K-T1)', () => {
  it('bagian tersembunyi bila tidak ada pemilik terdaftar', () => {
    tampil({ ...detail, pemilik_terdaftar: [] } as unknown as Detail);
    expect(screen.queryByRole('region', { name: 'Pemilik terdaftar' })).toBeNull();
    cleanup();
    tampil({ ...detail, pemilik_terdaftar: undefined } as unknown as Detail);
    expect(screen.queryByRole('region', { name: 'Pemilik terdaftar' })).toBeNull();
  });

  it('dua klik dengan alasan wajib, lalu detail dimuat ulang', async () => {
    const p = tampil(detail);
    expect(screen.getByRole('region', { name: 'Pemilik terdaftar' }).textContent).toContain('Budi Santoso');
    fireEvent.click(screen.getByRole('button', { name: 'Cabut kepemilikan Budi Santoso' }));
    expect(screen.getByText(/tidak lagi bisa mengubah profil/)).toBeTruthy();
    const cabut = screen.getByRole('button', { name: 'Cabut' });
    expect((cabut as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan mencabut/ }), { target: { value: 'Bukan pemilik' } });
    fireEvent.click(cabut);
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/admin/umkm-tugas/klaim/${oid}/cabut`);
    expect(JSON.parse(init.body)).toMatchObject({ expected_version: 4, alasan: 'Bukan pemilik' });
    expect(JSON.parse(init.body).operasi_id).toBeTruthy();
  });

  it('galat tampil tenang dan detail tidak dimuat ulang', async () => {
    fetchMock.mockImplementation(() => galat('KONFLIK_VERSI', 409));
    const p = tampil(detail);
    fireEvent.click(screen.getByRole('button', { name: 'Cabut kepemilikan Budi Santoso' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan mencabut/ }), { target: { value: 'Bukan pemilik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cabut' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('berubah atau telah diambil');
    expect(p.onRefresh).not.toHaveBeenCalled();
  });
});

describe('profil mandiri di formulir (K-R1)', () => {
  const mandiri = { ...detail, sumber: 'mandiri', pemilik_terdaftar: [] } as unknown as Detail;
  it('sumber mandiri tampil sebagai teks dan simpanan mengirim kurasi', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      data: { id: pid, versi: 4, status: 'diterbitkan' }, meta: { request_id: 'r' } }))));
    const saved = vi.fn();
    render(<ProfilForm detail={mandiri} onSaved={saved} onCancel={vi.fn()} />);
    expect(screen.getByText('Sumber: didaftarkan pemilik')).toBeTruthy();
    expect(screen.queryByLabelText('Sumber data')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data.sumber).toBe('kurasi');
  });
});
