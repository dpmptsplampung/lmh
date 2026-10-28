// @vitest-environment jsdom
// Fase 4 (spec §7): chat diselesaikan petugas = Pendataan Umum (identitas dari profil + topik + catatan) + Pendataan
// Khusus Layanan itu. Tanpa migrasi / tanpa perubahan = badan permintaan lama (alur tidak berubah).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { tabel, kueri } = vi.hoisted(() => ({
  tabel: {} as Record<string, { data?: unknown; error?: { code?: string; message: string } | null; tunda?: Promise<void> }>,
  kueri: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (nama: string) => {
      kueri.push(nama);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const { tunda, ...hasil } = tabel[nama] ?? { data: [] };
        return Promise.resolve(tunda).then(() => ({ error: null, ...hasil })).then(res, rej);
      };
      return b;
    },
  }),
}));

import { ChatSelesaiDialog } from './ChatAksiDialog';

const FID = 'aaaaaaaa-0000-4000-8000-000000000001';
const fld = (o: Record<string, unknown> = {}) => ({
  id: FID, layanan_id: 'ly1', label: 'Jenis pertanyaan', jenis: 'pilihan_tunggal', wajib: true, opsi: ['Umum', 'Teknis'],
  urut: 0, tersembunyi: false, pernah_diisi: false, ...o,
});
const PROFIL = { nama: 'Budi Santoso', kontak_hp: '081234567890', email: 'budi@x.id', asal_instansi: 'CV Maju', kategori: 'UMKM', keperluan: 'Mengurus NIB usaha' };

let fetchMock: ReturnType<typeof vi.fn>;
const badan = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

function render1(peran: 'fo' | 'layanan') {
  return render(
    <ChatSelesaiDialog
      sesiId="s1" namaPengunjung="Budi" peran={peran} layananId={peran === 'layanan' ? 'ly1' : null}
      topikFo={[{ id: 'tf1', nama: 'Informasi', urut: 0 }]} onClose={vi.fn()} onBerhasil={vi.fn()}
    />,
  );
}
async function isiTopikCatatan(peran: 'fo' | 'layanan') {
  const topik = await screen.findByLabelText(/^Topik/);
  await waitFor(() => expect((topik as HTMLSelectElement).options.length).toBeGreaterThan(1));
  fireEvent.change(topik, { target: { value: peran === 'fo' ? 'tf1' : 'tl1' } });
  fireEvent.change(screen.getByLabelText(/^Catatan/), { target: { value: 'Sudah dijawab' } });
}

beforeEach(() => {
  kueri.length = 0;
  for (const k of Object.keys(tabel)) delete tabel[k];
  tabel.topik_penanganan = { data: [{ id: 'tl1', nama: 'Konsultasi' }] };
  tabel.kunjungan = { data: { ...PROFIL } };
  tabel.pendataan_khusus_field = { data: [fld()] };
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: { ok: true } }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('ChatSelesaiDialog: Pendataan Umum + Khusus', () => {
  it('petugas Layanan: identitas terisi dari profil dan isian Khusus tampil', async () => {
    render1('layanan');
    expect(((await screen.findByLabelText(/Nama pengunjung/)) as HTMLInputElement).value).toBe('');
    await waitFor(() => expect((screen.getByLabelText(/Nama pengunjung/) as HTMLInputElement).value).toBe('Budi Santoso'));
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id');
    expect(await screen.findByLabelText(/Jenis pertanyaan/)).toBeTruthy();
  });

  it('mengirim khusus + hanya identitas yang berubah bersama topik/catatan', async () => {
    render1('layanan');
    await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
    await isiTopikCatatan('layanan');
    fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Teknis' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'baru@x.id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(badan()).toEqual({
      sesi_id: 's1', aksi: 'selesaikan', topik_id: 'tl1', catatan: 'Sudah dijawab',
      khusus: { [FID]: 'Teknis' }, identitas: { email: 'baru@x.id' },
    });
  });

  it('isian Khusus wajib kosong: tidak mengirim, galat role=alert', async () => {
    render1('layanan');
    await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
    await isiTopikCatatan('layanan');
    await screen.findByLabelText(/Jenis pertanyaan/);
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    expect((await screen.findByText(/Jenis pertanyaan wajib diisi/)).getAttribute('role')).toBe('alert');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identitas tidak valid ditolak di klien', async () => {
    render1('layanan');
    await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
    await isiTopikCatatan('layanan');
    fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'bukan-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    expect(await screen.findByText('Email tidak valid.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tahap FO: identitas tampil, tanpa isian Khusus; tanpa perubahan = badan lama', async () => {
    render1('fo');
    await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
    expect(screen.queryByLabelText(/Jenis pertanyaan/)).toBeNull();
    await isiTopikCatatan('fo');
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(badan()).toEqual({ sesi_id: 's1', aksi: 'selesaikan', topik_id: 'tf1', catatan: 'Sudah dijawab' });
  });

  it('migrasi belum diterapkan: tanpa blok identitas/Khusus; badan lama', async () => {
    tabel.pendataan_khusus_field = { error: { code: 'PGRST205', message: 'no table' } };
    render1('layanan');
    await isiTopikCatatan('layanan');
    expect(screen.queryByLabelText(/Nama pengunjung/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(badan()).toEqual({ sesi_id: 's1', aksi: 'selesaikan', topik_id: 'tl1', catatan: 'Sudah dijawab' });
  });

  it('profil lama yang tidak valid TIDAK memblokir bila tidak diubah (nama berangka/emoji, keperluan pendek, kategori di luar daftar)', async () => {
    tabel.kunjungan = { data: { ...PROFIL, nama: 'Budi 😀 2', keperluan: 'singkat', kategori: 'Lain-lain' } };
    render1('layanan');
    await waitFor(() => expect((screen.getByLabelText(/Nama pengunjung/) as HTMLInputElement).value).toBe('Budi 😀 2'));
    // kategori di luar daftar tidak tampil kosong: nilainya tetap terlihat sebagai pilihan terpilih.
    const kategori = screen.getByLabelText(/Kategori/) as HTMLSelectElement;
    expect(kategori.value).toBe('Lain-lain');
    expect(kategori.selectedOptions[0].textContent).toMatch(/Lain-lain/);
    await isiTopikCatatan('layanan');
    fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(badan()).toEqual({ sesi_id: 's1', aksi: 'selesaikan', topik_id: 'tl1', catatan: 'Sudah dijawab', khusus: { [FID]: 'Umum' } });
  });

  it('kolom yang DIUBAH tetap divalidasi: keperluan lama pendek diganti pendek lagi -> galat', async () => {
    tabel.kunjungan = { data: { ...PROFIL, keperluan: 'singkat' } };
    render1('layanan');
    await waitFor(() => expect((screen.getByLabelText(/Keperluan/) as HTMLTextAreaElement).value).toBe('singkat'));
    await isiTopikCatatan('layanan');
    fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
    fireEvent.change(screen.getByLabelText(/Keperluan/), { target: { value: 'pendek' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    expect(await screen.findByText('Keperluan 10-500 karakter.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mengedit satu kolom SEBELUM profil termuat tidak membekukan prapengisian kosong kolom lain', async () => {
    let lepas: () => void = () => {};
    tabel.kunjungan = { data: { ...PROFIL }, tunda: new Promise<void>((r) => { lepas = r; }) };
    render1('layanan');
    const email = (await screen.findByLabelText(/Email/)) as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'baru@x.id' } });
    lepas();
    await waitFor(() => expect((screen.getByLabelText(/Nama pengunjung/) as HTMLInputElement).value).toBe('Budi Santoso'));
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('baru@x.id');
    await isiTopikCatatan('layanan');
    fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(badan().identitas).toEqual({ email: 'baru@x.id' });
  });

  describe('deploy sebagian (0001 tanpa 0002) dan perubahan isian saat dialog terbuka', () => {
    const galat409 = () => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'x', kode: 'MIGRASI_BELUM_DITERAPKAN' }) });
    const sukses = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: { ok: true } }) });

    it('fungsi belum ada + tanpa jawaban Khusus wajib/identitas berubah: ulangi dengan chat_selesai lama', async () => {
      tabel.pendataan_khusus_field = { data: [fld({ wajib: false })] };
      fetchMock.mockReset();
      fetchMock.mockImplementationOnce(galat409).mockImplementationOnce(sukses);
      const onBerhasil = vi.fn();
      render(
        <ChatSelesaiDialog sesiId="s1" namaPengunjung="Budi" peran="layanan" layananId="ly1" topikFo={[]} onClose={vi.fn()} onBerhasil={onBerhasil} />,
      );
      await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
      await isiTopikCatatan('layanan');
      await screen.findByLabelText(/Jenis pertanyaan/);
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ sesi_id: 's1', aksi: 'selesaikan', topik_id: 'tl1', catatan: 'Sudah dijawab' });
      await waitFor(() => expect(onBerhasil).toHaveBeenCalled());
    });

    it('fungsi belum ada + isian wajib/identitas berubah: pesan jelas, tidak mengulang', async () => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(galat409);
      render1('layanan');
      await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
      await isiTopikCatatan('layanan');
      fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
      const alert = await screen.findByText(/belum aktif sepenuhnya di server/);
      expect(alert.getAttribute('role')).toBe('alert');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('server menolak isian (KHUSUS_TIDAK_VALID): isian dimuat ulang dan pesan jelas', async () => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 422, json: () => Promise.resolve({ error: 'tidak valid', kode: 'KHUSUS_TIDAK_VALID' }) }));
      render1('layanan');
      await waitFor(() => expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('budi@x.id'));
      await isiTopikCatatan('layanan');
      fireEvent.change(await screen.findByLabelText(/Jenis pertanyaan/), { target: { value: 'Umum' } });
      const sebelum = kueri.filter((n) => n === 'pendataan_khusus_field').length;
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan chat' }));
      expect((await screen.findByText(/berubah\. Formulir dimuat ulang/)).getAttribute('role')).toBe('alert');
      await waitFor(() => expect(kueri.filter((n) => n === 'pendataan_khusus_field').length).toBeGreaterThan(sebelum));
    });
  });
});
