// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ daftar: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/investasi', async (impor) => ({ ...(await impor<typeof import('@/lib/data/investasi')>()), daftarIproKelola: h.daftar }));

import DaftarIpro from './DaftarIpro';

const baris = (o: Record<string, unknown>) => ({
  id: '3f2b9c1e-1111-4222-8333-444455556666', sumber: 'ptsp', status: 'draf', judul: 'Kawasan Industri Tanggamus', sektor: 'industri',
  kab_kota: 'Kab. Tanggamus', diubah_pada: '2026-11-18T03:00:00Z', ...o,
});
const hasil = (data: unknown[], count = data.length) => Promise.resolve({ data, error: null, count });
const panggilanTerakhir = () => h.daftar.mock.calls.at(-1)![1];

beforeEach(() => {
  h.daftar.mockReset();
  h.daftar.mockImplementation(() => hasil([
    baris({}),
    baris({ id: '3f2b9c1e-2222-4222-8333-444455556666', sumber: 'foila', status: 'terbit', judul: 'PLTMH Way Besai', sektor: 'energi', kab_kota: 'Kab. Lampung Barat' }),
  ]));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('DaftarIpro', () => {
  it('menampilkan tabel ber-caption dengan kolom, lencana sumber/status, dan tautan ke detail admin', async () => {
    render(<DaftarIpro basis="admin" />);
    const tabel = await screen.findByRole('table', { name: 'Daftar IPRO' });
    for (const k of ['Judul', 'Sumber', 'Sektor', 'Kab/Kota', 'Status', 'Diperbarui']) expect(within(tabel).getByRole('columnheader', { name: k })).toBeTruthy();
    expect(within(tabel).getByRole('link', { name: 'Kawasan Industri Tanggamus' }).getAttribute('href')).toBe('/admin/ipro/3f2b9c1e-1111-4222-8333-444455556666');
    expect(within(tabel).getByText('FOILA')).toBeTruthy();
    expect(within(tabel).getByText('Terbit')).toBeTruthy();
    expect(within(tabel).getByText('Industri')).toBeTruthy();
    expect(screen.getByText('Menampilkan 1-2 dari 2 IPRO')).toBeTruthy();
    expect(panggilanTerakhir()).toEqual({ dari: 0, sampai: 19 });
  });

  it('tombol tambah menuju /baru?sumber= sesuai basis admin atau petugas', async () => {
    const { unmount } = render(<DaftarIpro basis="admin" />);
    expect(screen.getByRole('link', { name: /Tambah IPRO PTSP/ }).getAttribute('href')).toBe('/admin/ipro/baru?sumber=ptsp');
    expect(screen.getByRole('link', { name: /Tambah kartu FOILA/ }).getAttribute('href')).toBe('/admin/ipro/baru?sumber=foila');
    await screen.findByRole('table');
    unmount();
    render(<DaftarIpro basis="petugas" />);
    expect(screen.getByRole('link', { name: /Tambah kartu FOILA/ }).getAttribute('href')).toBe('/petugas/investasi/ipro/baru?sumber=foila');
    expect((await screen.findByRole('link', { name: 'PLTMH Way Besai' })).getAttribute('href')).toBe('/petugas/investasi/ipro/3f2b9c1e-2222-4222-8333-444455556666');
  });

  it('saringan status dan sumber memanggil data dengan opsi yang tepat dan kembali ke halaman 1', async () => {
    render(<DaftarIpro basis="admin" />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'terbit' } });
    await waitFor(() => expect(panggilanTerakhir()).toMatchObject({ status: 'terbit', dari: 0 }));
    fireEvent.change(screen.getByLabelText('Sumber'), { target: { value: 'foila' } });
    await waitFor(() => expect(panggilanTerakhir()).toMatchObject({ status: 'terbit', sumber: 'foila' }));
  });

  it('pencarian judul tertunda 300 ms', async () => {
    render(<DaftarIpro basis="admin" />);
    await screen.findByRole('table');
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Cari judul'), { target: { value: ' wisata ' } });
    expect(panggilanTerakhir()).not.toHaveProperty('cari');
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(panggilanTerakhir()).toMatchObject({ cari: 'wisata' });
  });

  it('penomoran halaman memakai rentang 20 baris', async () => {
    h.daftar.mockImplementation((_sb, o: { dari: number }) => hasil([baris({ judul: `Proyek ${o.dari}` })], 45));
    render(<DaftarIpro basis="admin" />);
    await screen.findByText('Halaman 1 dari 3');
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await screen.findByText('Halaman 2 dari 3');
    expect(panggilanTerakhir()).toMatchObject({ dari: 20, sampai: 39 });
    expect(screen.getByText('Menampilkan 21-21 dari 45 IPRO')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sebelumnya' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keadaan kosong tanpa saringan dan dengan saringan dibedakan', async () => {
    h.daftar.mockImplementation(() => hasil([]));
    render(<DaftarIpro basis="admin" />);
    expect(await screen.findByText('Belum ada IPRO')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'arsip' } });
    expect(await screen.findByText('Tidak ada hasil')).toBeTruthy();
  });

  it('galat memuat menampilkan pesan dan coba lagi memuat ulang', async () => {
    h.daftar.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: 'x' } }));
    render(<DaftarIpro basis="admin" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/belum dapat dimuat/);
    fireEvent.click(within(alert).getByRole('button'));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(h.daftar).toHaveBeenCalledTimes(2);
  });
});
