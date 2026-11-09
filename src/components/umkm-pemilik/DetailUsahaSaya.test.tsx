// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/foto/kompres', () => ({ kompresBerkas: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })) }));
vi.mock('@/lib/storage/unggah', () => ({ unggahKeR2: vi.fn(async () => ({ kunci: 'umkm-draf/p1/acak.jpg' })) }));
import { unggahKeR2 } from '@/lib/storage/unggah';
import DetailUsahaSaya from './DetailUsahaSaya';

const id = '10000000-0000-4000-8000-000000000001';
const NOMOR = '081234567890';
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data, meta: { request_id: 'req-1' } }), { status: 200 }));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code, message: 'x' }, request_id: 'req-1' }), { status }));
const revisi = { id: 'rv1', profil_id: id, versi: 1, nama: 'Kopi Lampung', deskripsi: 'Kopi kebun', alamat: null,
  jenis: 'Produk', kategori: 'Minuman', spesifik: null, kabupaten_kota: 'Lampung Barat', memiliki_nib: false,
  instagram: null, tiktok: null, dibuat_pada: '2026-11-05T03:00:00Z', keputusan: 'terbit' };
const detail = (ekstra = {}) => ({
  id, profil_nama: 'Kopi Lampung', status: 'terbit', versi: 4, pemilik_id: 'pm', pemilik_status: 'disetujui',
  dibuat_pada: '2026-11-05T03:00:00Z', alasan_tolak: null, catatan_petugas: null, memiliki_nib: false, perubahan: null,
  revisi, foto: [{ id: 'f1', revisi_id: 'rv1', asal: 'unggahan', url: null, r2_key: 'umkm-draf/p1/a.jpg',
    tersembunyi: false, perlu_review: false, diperiksa_pada: null }],
  nomor: NOMOR, izin_status: 'diberikan', ...ekstra,
});
const tren = Array.from({ length: 30 }, (_, i) => ({
  hari: `2026-10-${String(i + 1).padStart(2, '0')}`, dilihat: null, suka: i === 29 ? 2 : 0, permintaan: 0, nomor_dibuka: 0,
}));
const statistik = { dilihat: null, suka: 7, permintaan: 3, nomor_dibuka: 1, telemetri_opsional_aktif: false, tren };
let fetchMock: ReturnType<typeof vi.fn>;
let data: Record<string, unknown>;
beforeEach(() => {
  data = detail();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return ok({ id, versi: 5, status: 'diajukan', revisi_id: 'rv2', pemilik_id: 'pm', pemilik_status: 'disetujui' });
    if (url.endsWith('/statistik')) return ok(statistik);
    if (url.includes('/penerima')) return ok({ items: [{ nama: 'PT Maju', dibuka_pada: '2026-11-06T03:00:00Z' }], next_cursor: null });
    return ok(data);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); vi.clearAllMocks(); });
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST');

describe('detail Usaha saya', () => {
  it('pemilik menunggu pemeriksaan hanya melihat status, tanpa statistik, nomor, atau ubah', async () => {
    data = detail({ pemilik_status: 'diajukan', revisi: null, foto: [], nomor: null, izin_status: null });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/Menunggu pemeriksaan, diajukan 2026-11-05/)).toBeTruthy();
    expect(screen.getByText(/Hak mengubah, statistik, dan nomor berlaku sesudah/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah profil' })).toBeNull();
    expect(screen.queryByText('Statistik profil')).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/statistik'))).toBe(false);
  });

  it('profil mandiri ditolak: alasan jadi catatan petugas, tetap bisa kirim perbaikan dengan foto', async () => {
    data = detail({ status: 'ditolak', pemilik_status: 'diajukan', nomor: null, izin_status: null,
      catatan_petugas: 'Foto belum jelas', foto: [] });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/Catatan petugas: Foto belum jelas/)).toBeTruthy();
    expect(screen.getByText('Perlu diperbaiki')).toBeTruthy();
    expect(screen.queryByText(/Menunggu pemeriksaan/)).toBeNull();
    expect(screen.queryByText(/Hak mengubah, statistik, dan nomor berlaku sesudah/)).toBeNull();
    expect(screen.queryByText('Statistik profil')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ubah profil' }));
    expect(screen.getByText(/belum tampil di katalog/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(unggahKeR2).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Kirim untuk diperiksa' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/umkm-pemilik/${id}/draf`);
    expect(JSON.parse(posts()[0][1].body).data.foto).toEqual([{ asal: 'unggahan', r2_key: 'umkm-draf/p1/acak.jpg' }]);
  });

  it('perubahan menunggu: pesan menunggu, bagian data berjudul Perubahan yang diajukan', async () => {
    data = detail({ status: 'diajukan', perubahan: 'menunggu' });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText('Perubahan menunggu pemeriksaan. Versi lama tetap tampil sampai diperiksa.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Perubahan yang diajukan' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Data profil' })).toBeNull();
  });

  it('perubahan ditolak: Perubahan belum disetujui beserta catatan petugas', async () => {
    data = detail({ perubahan: 'ditolak', catatan_petugas: 'Foto buram' });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/Perubahan belum disetujui\./)).toBeTruthy();
    expect(screen.getByText(/Catatan petugas: Foto buram/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Perubahan yang diajukan' })).toBeTruthy();
  });

  it('tanpa perubahan bagian data tetap berjudul Data profil', async () => {
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByRole('heading', { name: 'Data profil' })).toBeTruthy();
  });

  it('kirim draf pada profil disembunyikan (KONFLIK_STATUS) memberi pesan khusus', async () => {
    data = detail({ status: 'disembunyikan' });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === 'POST'
      ? galat('KONFLIK_STATUS', 409) : url.endsWith('/statistik') ? ok(statistik) : url.includes('/penerima')
        ? ok({ items: [], next_cursor: null }) : ok(data));
    render(<DetailUsahaSaya id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah profil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim untuk diperiksa' }));
    expect(await screen.findByText('Profil sedang disembunyikan petugas. Perubahan bisa dikirim lagi sesudah petugas memulihkannya.'))
      .toBeTruthy();
  });

  it('ditolak menampilkan catatan petugas', async () => {
    data = detail({ pemilik_status: 'ditolak', revisi: null, foto: [], nomor: null, izin_status: null,
      catatan_petugas: null, alasan_tolak: 'Bukti belum cukup' });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/Catatan petugas: Bukti belum cukup/)).toBeTruthy();
  });

  it('pemilik disetujui: nomor sendiri, informasi NIB, statistik 30 hari, dan perusahaan penerima', async () => {
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(NOMOR)).toBeTruthy();
    expect(screen.getByText(/belum tercatat memiliki NIB\. NIB gratis/)).toBeTruthy();
    const dl = (await screen.findByText('Permintaan nomor', { selector: 'dt' })).closest('dl')!;
    expect(within(dl).getByText('7')).toBeTruthy();
    expect(within(dl).getByText('Tidak dicatat')).toBeTruthy();
    expect(screen.getByText(/Suka dalam 30 hari terakhir: 2/)).toBeTruthy();
    expect(screen.getAllByText(/^2026-10-/)).toHaveLength(30);
    expect(await screen.findByText(/PT Maju, dibuka 2026-11-06/)).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe(`/api/umkm-pemilik/${id}/foto/f1`);
    // Tidak ada data pemohon selain nama perusahaan dan tanggal.
    expect(document.body.textContent).not.toMatch(/@|jabatan/i);
  });

  it('NIB tercatat tidak menampilkan informasi NIB', async () => {
    data = detail({ memiliki_nib: true });
    render(<DetailUsahaSaya id={id} />);
    await screen.findByText(NOMOR);
    expect(screen.queryByText(/NIB gratis/)).toBeNull();
  });

  it('nomor tidak masuk penyimpanan peramban, konsol, atau URL', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const konsol = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<DetailUsahaSaya id={id} />);
    await screen.findByText(NOMOR);
    expect(setItem).not.toHaveBeenCalled();
    expect(konsol).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes(NOMOR))).toBe(true);
    expect(window.location.href).not.toContain(NOMOR);
    expect(fetchMock.mock.calls.every(([, i]) => (i?.cache ?? 'no-store') === 'no-store')).toBe(true);
    setItem.mockRestore(); konsol.mockRestore();
  });

  it('ubah lewat draf: keterangan versi lama, kirim dengan versi dan sosial, nomor tidak dikirim bila kosong', async () => {
    render(<DetailUsahaSaya id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah profil' }));
    expect(screen.getByText(/Versi lama tetap tampil di katalog sampai perubahan diperiksa/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('TikTok (opsional)'), { target: { value: 'https://www.tiktok.com/@kopi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim untuk diperiksa' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0];
    expect(url).toBe(`/api/umkm-pemilik/${id}/draf`);
    const body = JSON.parse(init.body);
    expect(body.expected_version).toBe(4);
    expect(body.data.tiktok).toBe('https://www.tiktok.com/@kopi');
    expect(body.data).not.toHaveProperty('nomor');
    expect(body.data.foto).toEqual([{ asal: 'unggahan', url: null, r2_key: 'umkm-draf/p1/a.jpg' }]);
  });

  it('unggah foto draf memakai area umkm-draf dengan awalan ID profil', async () => {
    render(<DetailUsahaSaya id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah profil' }));
    const berkas = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Unggah foto'), { target: { files: [berkas] } });
    await waitFor(() => expect(unggahKeR2).toHaveBeenCalled());
    const [area, path] = vi.mocked(unggahKeR2).mock.calls[0];
    expect(area).toBe('umkm-draf');
    expect(path).toMatch(new RegExp(`^${id}/[0-9a-f-]+\\.jpg$`));
    expect(await screen.findByText('Foto unggahan baru 2')).toBeTruthy();
  });

  it('cabut izin meminta konfirmasi berisi teks pencabutan lalu memanggil route', async () => {
    render(<DetailUsahaSaya id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cabut izin nomor' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Setelah dicabut, nomor Anda tidak lagi diberikan ke perusahaan baru dan tidak tampil di akun perusahaan di LMH.');
    expect(dialog.textContent).toContain('Perusahaan yang sudah menerima nomor Anda mungkin masih menyimpannya.');
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ya, cabut izin' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(`/api/umkm-pemilik/${id}/cabut-izin`);
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ expected_version: 4 });
  });

  it('izin sudah dicabut tidak menawarkan pencabutan lagi', async () => {
    data = detail({ izin_status: 'dicabut' });
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/Izin sudah dicabut/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cabut izin nomor' })).toBeNull();
  });

  it('galat 401 menampilkan Masuk dan 404 pesan tidak ditemukan', async () => {
    fetchMock.mockImplementation(() => galat('LOGIN_DIPERLUKAN', 401));
    render(<DetailUsahaSaya id={id} />);
    expect((await screen.findByRole('link', { name: 'Masuk' })).getAttribute('href')).toContain('/login?next=');
    cleanup();
    fetchMock.mockImplementation(() => galat('TIDAK_DITEMUKAN', 404));
    render(<DetailUsahaSaya id={id} />);
    expect(await screen.findByText(/tidak ditemukan atau bukan milik akun ini/)).toBeTruthy();
  });
});
