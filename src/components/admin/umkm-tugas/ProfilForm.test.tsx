// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfilForm from './ProfilForm';

const mocks = vi.hoisted(() => ({ compress: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/foto/kompres', () => ({ kompresBerkas: mocks.compress }));
vi.mock('@/lib/storage/unggah', () => ({ unggahKeR2: mocks.upload }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'baru', versi: 1, status: 'diajukan' } }) }));
  vi.stubGlobal('fetch', fetchMock);
  mocks.compress.mockReset().mockResolvedValue(new Blob(['foto'], { type: 'image/jpeg' }));
  mocks.upload.mockReset().mockResolvedValue({ kunci: 'umkm-draf/foto.jpg' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill() {
  for (const [name, value] of [['Nama usaha', 'Kopi Lampung'], ['Jenis', 'Minuman'], ['Kategori', 'Kopi'], ['Kabupaten/kota', 'Lampung Barat']]) fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
it('NIB dan nomor opsional, sumber tercatat dan sosial kosong menjadi null', async () => {
  const saved = vi.fn();
  render(<ProfilForm onSaved={saved} onCancel={vi.fn()} />); fill();
  fireEvent.change(screen.getByLabelText('Sumber data'), { target: { value: 'satudata' } });
  fireEvent.change(screen.getByLabelText('Tambah tautan foto HTTPS'), { target: { value: 'https://satudata.example/foto.jpg' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.data).toMatchObject({ sumber: 'satudata', memiliki_nib: null, instagram: null, tiktok: null, foto: [{ asal: 'satudata', url: 'https://satudata.example/foto.jpg' }] });
  expect(body.data).not.toHaveProperty('nomor');
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('nomor input dibersihkan setelah simpan dan saat keluar, tanpa state atau storage browser', async () => {
  const saved = vi.fn();
  const view = render(<ProfilForm onSaved={saved} onCancel={vi.fn()} />); fill();
  const input = screen.getByLabelText('Nomor WhatsApp (opsional)') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '081299998888' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '081299998888' } });
  view.unmount();
  expect(input.value).toBe('');
});
it('tautan sosial di luar domain ditolak dekat field dan tidak dikirim', async () => {
  render(<ProfilForm onSaved={vi.fn()} onCancel={vi.fn()} />); fill();
  const input = screen.getByLabelText('Instagram (opsional)');
  fireEvent.change(input, { target: { value: 'https://example.com/profil' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('unggahan dikompres lalu disimpan sebagai draft R2 privat', async () => {
  const saved = vi.fn();
  render(<ProfilForm onSaved={saved} onCancel={vi.fn()} />); fill();
  const file = new File(['foto'], 'usaha.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [file] } });
  await screen.findByText('1 foto disiapkan untuk pemeriksaan.');
  expect(mocks.compress).toHaveBeenCalledWith(file);
  expect(mocks.upload).toHaveBeenCalledWith('umkm-draf', expect.stringMatching(/\.jpg$/), expect.any(Blob));
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).data.foto).toEqual([{ asal: 'unggahan', r2_key: 'umkm-draf/foto.jpg' }]);
});
it('hasil kompresi terlambat dibuang bila form sudah ditinggalkan', async () => {
  let resolve!: (value: Blob) => void;
  mocks.compress.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const view = render(<ProfilForm onSaved={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
  view.unmount();
  await act(async () => resolve(new Blob(['x'], { type: 'image/jpeg' })));
  expect(mocks.upload).not.toHaveBeenCalled();
});
