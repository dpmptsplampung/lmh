// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { addDaysWIB, todayWIB } from '@/lib/time';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import BukuTamuPage from './page';

type Tamu = Record<string, unknown>;
const tamu = (o: Tamu = {}): Tamu => ({
  id: 't1', nama: 'Budi Santoso', instansi: 'Dinas X', no_hp: '+6281234567890', bertemu: 'Kepala Bidang', tujuan: 'Koordinasi',
  waktu_masuk: '2026-10-08T02:30:00Z', dicatat_oleh: 'p1', dicatat_nama: 'FO Satu', ...o,
});

let fetchMock: ReturnType<typeof vi.fn>;
let daftar: Tamu[];
let gagalMuat: boolean;
const urlGet = () => fetchMock.mock.calls.filter((c) => c[1]?.method !== 'POST').map((c) => String(c[0]));
const urlTerakhir = () => new URL(urlGet().at(-1)!, 'http://x');

beforeEach(() => {
  daftar = [tamu()];
  gagalMuat = false;
  fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ tamu: { id: 't2' } }) });
    if (gagalMuat) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Gagal memuat buku tamu' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: daftar, total: daftar.length, page: 1, limit: 50 }) });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

function pilihTujuhHari() {
  fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal buku tamu:/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Rentang tanggal buku tamu' })).getByRole('button', { name: '7 hari terakhir' }));
}

describe('buku tamu', () => {
  it('menampilkan keterangan peran dan tamu hari ini', async () => {
    render(<BukuTamuPage />);
    expect(await screen.findByText('Budi Santoso')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Front Office/);
  });

  it('kolom lengkap: tanggal, jam WIB, nama, instansi, nomor HP rapi, ditemui, tujuan, pencatat', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    const kepala = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(kepala).toEqual(['Waktu', 'Nama', 'Instansi', 'Nomor HP', 'Bertemu', 'Tujuan', 'Dicatat oleh']);
    const baris = screen.getAllByRole('row')[1];
    expect(baris.textContent).toMatch(/8 Okt 2026/);
    expect(baris.textContent).toMatch(/09[.:]30/); // 02:30 UTC = 09:30 WIB
    expect(baris.textContent).toContain('0812-3456-7890');
    expect(baris.textContent).toContain('Dinas X');
    expect(baris.textContent).toContain('FO Satu');
  });

  it('nomor HP kosong tampil sebagai tanda strip, bukan teks "null"', async () => {
    daftar = [tamu({ no_hp: null, instansi: null })];
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    expect(screen.getAllByRole('row')[1].textContent).not.toMatch(/null/);
  });

  it('memuat hari ini (WIB) secara bawaan dan menyebut jumlah tamu', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    const u = urlTerakhir();
    expect(u.searchParams.get('dari')).toBe(todayWIB());
    expect(u.searchParams.get('sampai')).toBe(todayWIB());
    expect(screen.getByRole('status').textContent).toMatch(/1 tamu/);
  });

  it('mengubah tanggal memuat ulang dengan rentang itu', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    pilihTujuhHari();
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(addDaysWIB(-6)));
    expect(urlTerakhir().searchParams.get('sampai')).toBe(todayWIB());
    expect(urlTerakhir().searchParams.get('page')).toBe('1');
  });

  it('rentang terbalik dinormalkan dan daftar baru dimuat setelah Terapkan', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    const sebelum = urlGet().length;
    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal buku tamu:/ }));
    const dialog = screen.getByRole('dialog', { name: 'Rentang tanggal buku tamu' });
    const klik = (iso: string) => fireEvent.click(dialog.querySelector<HTMLButtonElement>(`button[data-tanggal="${iso}"]`)!);
    klik(todayWIB());
    if (todayWIB().slice(5, 7) !== addDaysWIB(-1).slice(5, 7)) fireEvent.click(within(dialog).getByRole('button', { name: 'Bulan sebelumnya' }));
    klik(addDaysWIB(-1));
    expect(urlGet().length).toBe(sebelum);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(addDaysWIB(-1)));
    expect(urlTerakhir().searchParams.get('sampai')).toBe(todayWIB());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pencarian dikirim sebagai q; tombol Hari ini mengembalikan rentang dan mengosongkan pencarian', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    pilihTujuhHari();
    fireEvent.change(screen.getByLabelText('Cari tamu'), { target: { value: 'Dinas' } });
    await waitFor(() => expect(urlTerakhir().searchParams.get('q')).toBe('Dinas'));
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(todayWIB()));
    expect(urlTerakhir().searchParams.get('q')).toBeNull();
    expect((screen.getByLabelText('Cari tamu') as HTMLInputElement).value).toBe('');
  });

  it('menandai siapa yang mencatat tiap tamu (daftar tidak dibatasi)', async () => {
    daftar = [
      tamu({ id: 't1', dicatat_nama: 'FO Satu' }),
      tamu({ id: 't2', nama: 'Siti', dicatat_oleh: 'p2', dicatat_nama: 'FO Dua' }),
      tamu({ id: 't3', nama: 'Andi', dicatat_oleh: null, dicatat_nama: null }),
    ];
    render(<BukuTamuPage />);
    expect(await screen.findByRole('columnheader', { name: 'Dicatat oleh' })).toBeTruthy();
    expect(screen.getByText('FO Satu')).toBeTruthy();
    expect(screen.getByText('FO Dua')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('keadaan kosong hari ini', async () => {
    daftar = [];
    render(<BukuTamuPage />);
    expect(await screen.findByText(/Belum ada tamu tercatat hari ini/)).toBeTruthy();
  });

  it('keadaan kosong saat difilter berbeda dari hari ini', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    daftar = [];
    fireEvent.change(screen.getByLabelText('Cari tamu'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/Tidak ada tamu yang cocok/)).toBeTruthy();
  });

  it('galat memuat: pesan dan tombol Coba lagi yang memuat ulang', async () => {
    gagalMuat = true;
    render(<BukuTamuPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Gagal memuat buku tamu/);
    gagalMuat = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Budi Santoso')).toBeTruthy();
  });

  it('mencatat tamu lengkap: HP kanonik terkirim, daftar dimuat ulang', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    fireEvent.change(screen.getByLabelText(/^Nama tamu/), { target: { value: 'Siti Aminah' } });
    fireEvent.change(screen.getByLabelText(/Instansi/), { target: { value: 'PT Maju' } });
    fireEvent.change(screen.getByLabelText(/Nomor HP/), { target: { value: '0852-1111-2222' } });
    fireEvent.change(screen.getByLabelText(/Bertemu siapa/), { target: { value: 'Sekretaris' } });
    const sebelum = urlGet().length;
    fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/admin/buku-tamu');
    expect(JSON.parse(post[1].body)).toEqual({ nama: 'Siti Aminah', instansi: 'PT Maju', no_hp: '085211112222', bertemu: 'Sekretaris' });
    await waitFor(() => expect(urlGet().length).toBeGreaterThan(sebelum));
  });

  it('menolak input kurang tanpa memanggil server', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
    expect(await screen.findByText('Nomor HP wajib diisi.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
});
