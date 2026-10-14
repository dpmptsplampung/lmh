// @vitest-environment jsdom
// Halaman Kelola Topik Penanganan (Admin): daftar per cakupan (Front Office / layanan), tambah, ubah nama/urutan,
// nonaktifkan/aktifkan (tanpa hapus), langsung lewat PostgREST dengan mutasi tercek (mutasiWajibBaris/mutasiInsert).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import KelolaTopikPage from './page';
import { createClient } from '@/lib/supabase/client';

type Row = { id: string; layanan_id: string | null; nama: string; aktif: boolean; urut: number };
type Hasil = { data: unknown; error: { code?: string; message: string } | null };

const LAYANAN = [
  { id: 'l-oss', nama: 'Helpdesk OSS' },
  { id: 'l-bpjs', nama: 'BPJS Kesehatan' },
];
const TOPIK: Row[] = [
  { id: 't-fo-1', layanan_id: null, nama: 'Informasi umum', aktif: true, urut: 1 },
  { id: 't-fo-2', layanan_id: null, nama: 'Pengaduan', aktif: true, urut: 2 },
  { id: 't-fo-99', layanan_id: null, nama: 'Lainnya', aktif: false, urut: 99 },
  { id: 't-oss-1', layanan_id: 'l-oss', nama: 'Pendampingan NIB', aktif: true, urut: 1 },
  { id: 't-oss-2', layanan_id: 'l-oss', nama: 'Perubahan data', aktif: true, urut: 5 },
];

function buildMock(opts: {
  topik?: Row[];
  topikError?: boolean;
  updateHasil?: Hasil | Promise<Hasil>;
  insertHasil?: Hasil;
} = {}) {
  const updates: Array<{ nilai: Record<string, unknown>; id: string }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let muatTopik = 0;
  const mock = {
    from: vi.fn((tabel: string) => {
      if (tabel === 'layanan') {
        return { select: () => ({ order: () => Promise.resolve({ data: LAYANAN, error: null }) }) };
      }
      return {
        select: () => ({
          order: () => ({
            order: () => {
              muatTopik += 1;
              return Promise.resolve(
                opts.topikError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: opts.topik ?? TOPIK, error: null },
              );
            },
          }),
        }),
        update: (nilai: Record<string, unknown>) => ({
          eq: (_k: string, id: string) => ({
            select: () => {
              updates.push({ nilai, id });
              return Promise.resolve(opts.updateHasil ?? { data: [{ id }], error: null });
            },
          }),
        }),
        insert: (nilai: Record<string, unknown>) => ({
          select: () => {
            inserts.push(nilai);
            return Promise.resolve(opts.insertHasil ?? { data: [{ id: 'baru' }], error: null });
          },
        }),
      };
    }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock, updates, inserts, jumlahMuat: () => muatTopik };
}

beforeEach(() => {
  vi.clearAllMocks();
  toastMock.mockClear();
});
afterEach(() => cleanup());

describe('Kelola Topik: daftar', () => {
  it('menampilkan topik Front Office lebih dulu; jumlah per cakupan di pilihan; badge status', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    expect(await screen.findByText('Informasi umum')).toBeInTheDocument();
    expect(screen.getByText('Pengaduan')).toBeInTheDocument();
    expect(screen.queryByText('Pendampingan NIB')).not.toBeInTheDocument();
    const pilih = screen.getByLabelText('Cakupan topik');
    expect(within(pilih).getByRole('option', { name: 'Front Office (3)' })).toBeInTheDocument();
    expect(within(pilih).getByRole('option', { name: 'Helpdesk OSS (2)' })).toBeInTheDocument();
    expect(within(pilih).getByRole('option', { name: 'BPJS Kesehatan (0)' })).toBeInTheDocument();
    expect(screen.getByText('Nonaktif')).toBeInTheDocument();
    expect(screen.getAllByText('Aktif')).toHaveLength(2);
  });

  it('mengganti cakupan menampilkan topik layanan itu; cakupan kosong menampilkan petunjuk', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.change(screen.getByLabelText('Cakupan topik'), { target: { value: 'l-oss' } });
    expect(screen.getByText('Pendampingan NIB')).toBeInTheDocument();
    expect(screen.queryByText('Informasi umum')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Cakupan topik'), { target: { value: 'l-bpjs' } });
    expect(screen.getByText(/Belum ada topik untuk BPJS Kesehatan/)).toBeInTheDocument();
  });

  it('tabel punya keterangan dan header kolom; tidak ada tombol hapus', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    expect(screen.getByRole('table', { name: 'Topik penanganan Front Office' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Topik', 'Urutan', 'Status', 'Aksi']);
    expect(screen.queryByRole('button', { name: /hapus/i })).not.toBeInTheDocument();
  });

  it('gagal memuat: pesan role=alert dan tombol Tambah dinonaktifkan', async () => {
    buildMock({ topikError: true });
    render(<KelolaTopikPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat topik penanganan/);
    expect(screen.getByRole('button', { name: /Tambah topik/ })).toBeDisabled();
  });
});

describe('Kelola Topik: tambah', () => {
  const bukaTambah = async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: /Tambah topik/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah topik' });
    return { dialog, m };
  };

  it('dialog aksesibel: label terhubung, fokus ke nama, urutan awal = urutan terbesar (kecuali 99) + 1', async () => {
    const { dialog } = await bukaTambah();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Nama topik')).toHaveFocus();
    expect(within(dialog).getByLabelText('Urutan tampil')).toHaveValue(3);
    expect(dialog).toHaveTextContent('Cakupan: Front Office.');
  });

  it('validasi nama: terlalu pendek, terlalu panjang (dibatasi maxLength), dan duplikat tanpa beda huruf; RPC/insert tidak dipanggil', async () => {
    const { dialog, m } = await bukaTambah();
    const nama = within(dialog).getByLabelText('Nama topik');
    expect(nama).toHaveAttribute('maxlength', '100');

    fireEvent.change(nama, { target: { value: 'a' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nama topik harus 2-100 karakter.');
    expect(nama).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(nama, { target: { value: '  informasi UMUM ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Sudah ada topik dengan nama itu/);

    fireEvent.change(nama, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nama topik harus 2-100 karakter.');
    expect(m.inserts).toHaveLength(0);
  });

  it('validasi urutan: bilangan bulat 0-9999', async () => {
    const { dialog, m } = await bukaTambah();
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: 'Topik baru' } });
    for (const salah of ['', '-1', '1.5', '10000']) {
      fireEvent.change(within(dialog).getByLabelText('Urutan tampil'), { target: { value: salah } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Urutan harus bilangan bulat 0-9999/);
    }
    expect(m.inserts).toHaveLength(0);
  });

  it('berhasil: insert langsung (layanan_id null untuk Front Office), nama dipangkas, toast, dialog menutup, daftar dimuat ulang', async () => {
    const { dialog, m } = await bukaTambah();
    const muatAwal = m.jumlahMuat();
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: '  Legalitas usaha  ' } });
    fireEvent.change(within(dialog).getByLabelText('Urutan tampil'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(m.inserts).toEqual([{ layanan_id: null, nama: 'Legalitas usaha', urut: 4, aktif: true }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Legalitas usaha" ditambahkan', 'success'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(m.jumlahMuat()).toBeGreaterThan(muatAwal);
  });

  it('pada cakupan layanan: layanan_id terisi dan urutan awal mengikuti topik layanan itu', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.change(screen.getByLabelText('Cakupan topik'), { target: { value: 'l-oss' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah topik/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah topik' });
    expect(dialog).toHaveTextContent('Cakupan: Helpdesk OSS.');
    expect(within(dialog).getByLabelText('Urutan tampil')).toHaveValue(6);
    // Nama yang sama dengan topik Front Office BOLEH (cakupan berbeda).
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: 'Informasi umum' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(m.inserts).toEqual([{ layanan_id: 'l-oss', nama: 'Informasi umum', urut: 6, aktif: true }]));
  });

  it.each([
    ['23505', /Sudah ada topik dengan nama itu pada cakupan ini \(huruf besar\/kecil dianggap sama\)/],
    ['23514', /Nama topik harus 2-100 karakter/],
    ['42501', /tidak berwenang/],
    ['XX000', /Gagal menyimpan topik/],
  ])('galat DB %s dijelaskan di dialog (role=alert), dialog tetap terbuka', async (code, pola) => {
    const m = buildMock({ insertHasil: { data: null, error: { code, message: 'x' } } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: /Tambah topik/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: 'Topik baru' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(pola);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('ditambahkan'), 'success');
    expect(m.inserts).toHaveLength(1);
  });

  it('Escape menutup dialog dan fokus kembali ke tombol Tambah topik', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const pemicu = screen.getByRole('button', { name: /Tambah topik/ });
    pemicu.focus();
    fireEvent.click(pemicu);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pemicu).toHaveFocus();
  });
});

describe('Kelola Topik: ubah', () => {
  it('dialog terisi nilai lama; update nama + urutan lewat id; nama sendiri tidak dianggap duplikat', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Ubah topik Pengaduan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ubah topik' });
    expect(within(dialog).getByLabelText('Nama topik')).toHaveValue('Pengaduan');
    expect(within(dialog).getByLabelText('Urutan tampil')).toHaveValue(2);

    // Menyimpan nama yang sama (hanya ganti urutan) tidak bentrok dengan dirinya sendiri.
    fireEvent.change(within(dialog).getByLabelText('Urutan tampil'), { target: { value: '7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { nama: 'Pengaduan', urut: 7 }, id: 't-fo-2' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Pengaduan" diperbarui', 'success'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('mengganti nama menjadi nama topik lain di cakupan yang sama ditolak', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Ubah topik Pengaduan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: 'informasi umum' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Sudah ada topik dengan nama itu/);
    expect(m.updates).toHaveLength(0);
  });

  it('UPDATE 0 baris (ditolak RLS/baris hilang) = galat di dialog dan daftar dimuat ulang, bukan sukses palsu', async () => {
    const m = buildMock({ updateHasil: { data: [], error: null } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const muatAwal = m.jumlahMuat();
    fireEvent.click(screen.getByRole('button', { name: 'Ubah topik Pengaduan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nama topik'), { target: { value: 'Pengaduan layanan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/tidak berwenang mengubah data ini/);
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('diperbarui'), 'success');
    await waitFor(() => expect(m.jumlahMuat()).toBeGreaterThan(muatAwal));
  });
});

describe('Kelola Topik: nonaktifkan / aktifkan', () => {
  it('Nonaktifkan topik aktif: update aktif=false (tanpa menghapus); toast; muat ulang', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const muatAwal = m.jumlahMuat();
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan topik Informasi umum' }));
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { aktif: false }, id: 't-fo-1' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Informasi umum" dinonaktifkan', 'success'));
    await waitFor(() => expect(m.jumlahMuat()).toBeGreaterThan(muatAwal));
  });

  it('Aktifkan topik nonaktif: update aktif=true', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Aktifkan topik Lainnya' }));
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { aktif: true }, id: 't-fo-99' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Lainnya" diaktifkan', 'success'));
  });

  it('tombol dikunci selama request dan status diumumkan aria-live; klik ganda tidak mengirim dua kali', async () => {
    let selesai: (v: Hasil) => void = () => {};
    const tertunda = new Promise<Hasil>((r) => { selesai = r; });
    const m = buildMock({ updateHasil: tertunda });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const tombol = screen.getByRole('button', { name: 'Nonaktifkan topik Informasi umum' });
    fireEvent.click(tombol);
    fireEvent.click(tombol);
    await waitFor(() => expect(tombol).toBeDisabled());
    expect(tombol).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Ubah topik Informasi umum' })).toBeDisabled();
    expect(screen.getByText('Menonaktifkan topik Informasi umum…')).toHaveAttribute('aria-live', 'polite');
    expect(m.updates).toHaveLength(1);
    selesai({ data: [{ id: 't-fo-1' }], error: null });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('dinonaktifkan'), 'success'));
    await waitFor(() => expect(tombol).not.toBeDisabled());
  });

  it('galat: toast gagal (tidak ada toast sukses)', async () => {
    buildMock({ updateHasil: { data: null, error: { code: 'XX000', message: 'boom' } } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan topik Informasi umum' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah status topik'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('dinonaktifkan'), 'success');
  });
});
