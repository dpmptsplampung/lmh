// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PendataanKhususEditor from './PendataanKhususEditor';

const L = 'l1';
const fld = (o: Record<string, unknown>) => ({
  id: 'f1', layanan_id: L, label: 'Nomor surat', jenis: 'teks_singkat', wajib: true, opsi: [], urut: 0,
  tersembunyi: false, pernah_diisi: false, ...o,
});

let fetchMock: ReturnType<typeof vi.fn>;
function setup(daftar: unknown[], extra: { formTetap?: boolean; status?: number; kode?: string } = {}) {
  fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    const res = (ok: boolean, status: number, b: unknown) => Promise.resolve({ ok, status, json: () => Promise.resolve(b) });
    if ((init?.method ?? 'GET') === 'GET') {
      if (extra.status) return res(false, extra.status, { error: 'Pendataan Khusus belum tersedia', kode: extra.kode });
      return res(true, 200, { form_tetap: extra.formTetap ?? false, isian: daftar });
    }
    return res(true, 200, { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
}
const panggilanTulis = () => fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') !== 'GET');
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('PendataanKhususEditor', () => {
  it('isian yang pernah diisi: tidak ada tombol Hapus, hanya Sembunyikan; jenis terkunci saat ubah', async () => {
    setup([fld({ pernah_diisi: true })]);
    render(<PendataanKhususEditor layananId={L} />);
    expect(await screen.findByText('Nomor surat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hapus Nomor surat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sembunyikan Nomor surat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ubah Nomor surat' }));
    const jenis = screen.getByLabelText('Jenis isian') as HTMLSelectElement;
    expect(jenis.disabled).toBe(true);
    expect(screen.getByText(/pernah diisi/i)).toBeTruthy();
  });

  it('isian belum terisi bisa dihapus (DELETE)', async () => {
    setup([fld({})]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus Nomor surat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][0]).toBe(`/api/admin/layanan/${L}/pendataan-khusus/f1`);
    expect(panggilanTulis()[0][1].method).toBe('DELETE');
  });

  it('Sembunyikan mengirim PATCH tersembunyi=true', async () => {
    setup([fld({ pernah_diisi: true })]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sembunyikan Nomor surat' }));
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][1].method).toBe('PATCH');
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ tersembunyi: true });
  });

  it('tambah isian pilihan: opsi per baris dikirim sebagai array; label dan jenis berlabel', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah isian' }));
    fireEvent.change(screen.getByLabelText('Label isian'), { target: { value: 'Jenis izin' } });
    fireEvent.change(screen.getByLabelText('Jenis isian'), { target: { value: 'pilihan_tunggal' } });
    fireEvent.change(screen.getByLabelText(/Pilihan/), { target: { value: 'A\nB\n\n' } });
    fireEvent.click(screen.getByLabelText('Wajib diisi'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][1].method).toBe('POST');
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ label: 'Jenis izin', jenis: 'pilihan_tunggal', wajib: true, opsi: ['A', 'B'] });
  });

  it('galat server tampil di dalam dialog (role=alert)', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah isian' }));
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Layanan ini memakai formulir tetap', kode: 'LAYANAN_FORMULIR_TETAP' }) }));
    fireEvent.change(screen.getByLabelText('Label isian'), { target: { value: 'Nomor surat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/formulir tetap/);
  });

  it('Layanan ber-formulir tetap: keterangan tanpa editor', async () => {
    setup([], { formTetap: true });
    render(<PendataanKhususEditor layananId={L} />);
    expect(await screen.findByText(/formulir tetap/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tambah isian' })).toBeNull();
  });

  it('migrasi belum diterapkan: pesan jelas, tanpa editor', async () => {
    setup([], { status: 409, kode: 'MIGRASI_BELUM_DITERAPKAN' });
    render(<PendataanKhususEditor layananId={L} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/belum tersedia/i);
    expect(screen.queryByRole('button', { name: 'Tambah isian' })).toBeNull();
  });

  it('petunjuk identitas tidak ditanyakan ulang', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    expect(await screen.findByText(/jangan menanyakannya lagi/i)).toBeTruthy();
  });
});
