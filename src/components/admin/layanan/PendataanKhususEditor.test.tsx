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
  it('isian yang pernah diisi: tidak ada tombol Hapus, hanya Sembunyikan; jenis terkunci di baris rincian', async () => {
    setup([fld({ pernah_diisi: true })]);
    render(<PendataanKhususEditor layananId={L} />);
    expect(await screen.findByText('Nomor surat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hapus Nomor surat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sembunyikan Nomor surat' })).toBeTruthy();
    const rincian = screen.getByRole('button', { name: 'Rincian Nomor surat' });
    expect(rincian.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(rincian);
    expect(rincian.getAttribute('aria-expanded')).toBe('true');
    const jenis = screen.getByLabelText('Jenis isian') as HTMLSelectElement;
    expect(jenis.disabled).toBe(true);
    expect(screen.getByText(/pernah diisi/i)).toBeTruthy();
    expect(panggilanTulis()).toHaveLength(0);
  });

  it('isian belum terisi bisa dihapus (DELETE) lewat dialog konfirmasi', async () => {
    setup([fld({})]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus Nomor surat' }));
    expect(panggilanTulis()).toHaveLength(0);
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

  it('label diedit langsung di sel: Enter mengirim PATCH label; Esc membatalkan tanpa kiriman', async () => {
    setup([fld({})]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah label isian Nomor surat' }));
    const input = screen.getByRole('textbox', { name: 'Label isian Nomor surat' });
    fireEvent.change(input, { target: { value: 'Nomor surat tugas' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][0]).toBe(`/api/admin/layanan/${L}/pendataan-khusus/f1`);
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ label: 'Nomor surat tugas' });

    fireEvent.click(await screen.findByRole('button', { name: 'Ubah label isian Nomor surat' }));
    const lagi = screen.getByRole('textbox', { name: 'Label isian Nomor surat' });
    fireEvent.change(lagi, { target: { value: 'Tidak jadi' } });
    fireEvent.keyDown(lagi, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Label isian Nomor surat' })).toBeNull();
    expect(panggilanTulis()).toHaveLength(1);
  });

  it('label terlalu pendek ditolak di klien (alert di bawah input), galat server tampil di tempat yang sama', async () => {
    setup([fld({})]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah label isian Nomor surat' }));
    const input = screen.getByRole('textbox', { name: 'Label isian Nomor surat' });
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/2-100 karakter/);
    expect(panggilanTulis()).toHaveLength(0);

    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Label sudah dipakai isian lain' }) }));
    fireEvent.change(input, { target: { value: 'Label bentrok' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/sudah dipakai/));
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Wajib = saklar di baris: PATCH wajib dengan nilai kebalikannya', async () => {
    setup([fld({ wajib: true })]);
    render(<PendataanKhususEditor layananId={L} />);
    const saklar = await screen.findByRole('switch', { name: 'Wajib: Nomor surat' });
    expect((saklar as HTMLInputElement).checked).toBe(true);
    fireEvent.click(saklar);
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ wajib: false });
  });

  it('pilihan isian bertipe pilihan diedit di baris rincian: opsi per baris dikirim sebagai array; tanpa perubahan tidak mengirim', async () => {
    setup([fld({ jenis: 'pilihan_tunggal', opsi: ['A', 'B'] })]);
    render(<PendataanKhususEditor layananId={L} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rincian Nomor surat' }));
    const area = screen.getByLabelText('Pilihan (satu per baris)') as HTMLTextAreaElement;
    expect(area.value).toBe('A\nB');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }));
    expect(panggilanTulis()).toHaveLength(0);
    fireEvent.change(area, { target: { value: 'A\nB\n\nC ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }));
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][1].method).toBe('PATCH');
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ opsi: ['A', 'B', 'C'] });
  });

  it('tambah isian lewat baris terakhir: opsi per baris dikirim sebagai array; kolom pilihan hanya muncul untuk jenis pilihan', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    await screen.findByRole('button', { name: 'Tambah isian' });
    expect(screen.queryByLabelText(/Pilihan isian baru/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Label isian baru'), { target: { value: 'Jenis izin' } });
    fireEvent.change(screen.getByLabelText('Jenis isian baru'), { target: { value: 'pilihan_tunggal' } });
    fireEvent.change(screen.getByLabelText(/Pilihan isian baru/), { target: { value: 'A\nB\n\n' } });
    fireEvent.click(screen.getByLabelText('Wajib diisi'));
    fireEvent.click(screen.getByRole('button', { name: 'Tambah isian' }));
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(panggilanTulis()[0][1].method).toBe('POST');
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ label: 'Jenis izin', jenis: 'pilihan_tunggal', wajib: true, opsi: ['A', 'B'] });
  });

  it('tambah isian teks: opsi kosong dan Enter di isian label juga menambah', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    const label = await screen.findByLabelText('Label isian baru');
    fireEvent.change(label, { target: { value: 'Nomor surat' } });
    fireEvent.keyDown(label, { key: 'Enter' });
    await waitFor(() => expect(panggilanTulis()).toHaveLength(1));
    expect(JSON.parse(panggilanTulis()[0][1].body)).toEqual({ label: 'Nomor surat', jenis: 'teks_singkat', wajib: false, opsi: [] });
  });

  it('galat server tampil di bawah isian baris tambah (role=alert) dan isian tidak hilang', async () => {
    setup([]);
    render(<PendataanKhususEditor layananId={L} />);
    const label = await screen.findByLabelText('Label isian baru');
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Layanan ini memakai formulir tetap', kode: 'LAYANAN_FORMULIR_TETAP' }) }));
    fireEvent.change(label, { target: { value: 'Nomor surat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah isian' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/formulir tetap/);
    expect((label as HTMLInputElement).value).toBe('Nomor surat');
  });

  it('batas jumlah isian per Layanan: baris tambah diganti keterangan', async () => {
    setup(Array.from({ length: 40 }, (_, i) => fld({ id: `f${i}`, label: `Isian ${i}`, urut: i })));
    render(<PendataanKhususEditor layananId={L} />);
    expect(await screen.findByText(/Batas 40 isian per Layanan tercapai/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tambah isian' })).toBeNull();
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
