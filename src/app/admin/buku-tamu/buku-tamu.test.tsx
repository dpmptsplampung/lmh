// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import BukuTamuPage from './page';

let fetchMock: ReturnType<typeof vi.fn>;
let daftar: unknown[];
beforeEach(() => {
  daftar = [{ id: 't1', nama: 'Budi Santoso', instansi: 'Dinas X', no_hp: null, bertemu: 'Kepala Bidang', tujuan: 'Koordinasi', waktu_masuk: '2026-10-08T02:30:00Z', dicatat_oleh: 'p1', dicatat_nama: 'FO Satu' }];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (init?.method === 'POST') return ok({ tamu: { id: 't2' } });
    return ok({ items: daftar, total: daftar.length, page: 1, limit: 50 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('buku tamu', () => {
  it('menampilkan keterangan peran dan tamu hari ini', async () => {
    render(<BukuTamuPage />);
    expect(await screen.findByText('Budi Santoso')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Front Office/);
  });

  it('menandai siapa yang mencatat tiap tamu (daftar tidak dibatasi)', async () => {
    daftar = [
      { id: 't1', nama: 'Budi Santoso', instansi: null, no_hp: null, bertemu: 'Kabid', tujuan: null, waktu_masuk: '2026-10-08T02:30:00Z', dicatat_oleh: 'p1', dicatat_nama: 'FO Satu' },
      { id: 't2', nama: 'Siti', instansi: null, no_hp: null, bertemu: 'Sekretaris', tujuan: null, waktu_masuk: '2026-10-08T03:00:00Z', dicatat_oleh: 'p2', dicatat_nama: 'FO Dua' },
      { id: 't3', nama: 'Andi', instansi: null, no_hp: null, bertemu: 'Kabid', tujuan: null, waktu_masuk: '2026-10-08T03:30:00Z', dicatat_oleh: null, dicatat_nama: null },
    ];
    render(<BukuTamuPage />);
    expect(await screen.findByRole('columnheader', { name: 'Dicatat oleh' })).toBeTruthy();
    expect(screen.getByText('FO Satu')).toBeTruthy();
    expect(screen.getByText('FO Dua')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('keadaan kosong', async () => {
    daftar = [];
    render(<BukuTamuPage />);
    expect(await screen.findByText(/Belum ada tamu tercatat hari ini/)).toBeTruthy();
  });

  it('mencatat tamu: kirim field terisi saja, tanpa dicatat_oleh', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    fireEvent.change(screen.getByLabelText(/^Nama tamu/), { target: { value: 'Siti' } });
    fireEvent.change(screen.getByLabelText(/Bertemu siapa/), { target: { value: 'Sekretaris' } });
    fireEvent.change(screen.getByLabelText(/Instansi/), { target: { value: 'PT Maju' } });
    fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/admin/buku-tamu');
    expect(JSON.parse(post[1].body)).toEqual({ nama: 'Siti', bertemu: 'Sekretaris', instansi: 'PT Maju' });
  });

  it('menolak input kurang tanpa memanggil server', async () => {
    render(<BukuTamuPage />);
    await screen.findByText('Budi Santoso');
    fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
    expect(await screen.findByText(/minimal 2 karakter/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
});
