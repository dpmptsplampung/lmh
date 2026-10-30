// @vitest-environment jsdom
// Halaman Kelola Topik Penanganan (Admin): daftar per cakupan (Front Office / layanan), nama diedit langsung di sel,
// tambah lewat baris terakhir, urutan lewat tombol naik/turun, status lewat saklar (tanpa hapus), langsung lewat PostgREST
// dengan mutasi tercek (mutasiWajibBaris/mutasiInsert).
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

const ubahNamaInline = (nama: string, baru: string, tombol: 'Enter' | 'blur' = 'Enter') => {
  fireEvent.click(screen.getByRole('button', { name: `Ubah nama topik ${nama}` }));
  const input = screen.getByRole('textbox', { name: `Nama topik ${nama}` });
  fireEvent.change(input, { target: { value: baru } });
  if (tombol === 'Enter') fireEvent.keyDown(input, { key: 'Enter' });
  else fireEvent.blur(input);
  return input;
};
const kolomTambah = () => screen.getByRole('textbox', { name: 'Topik baru' });

describe('Kelola Topik: daftar', () => {
  it('menampilkan topik Front Office lebih dulu; jumlah per cakupan di daftar kiri dan di pilihan sempit; saklar status', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    expect(await screen.findByText('Informasi umum')).toBeInTheDocument();
    expect(screen.getByText('Pengaduan')).toBeInTheDocument();
    expect(screen.queryByText('Pendampingan NIB')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Pilih cakupan topik' });
    expect(within(nav).getByRole('button', { name: 'Front Office 3' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('button', { name: 'Helpdesk OSS 2' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('button', { name: 'BPJS Kesehatan 0' })).toBeInTheDocument();
    const pilih = screen.getByLabelText('Cakupan topik');
    expect(within(pilih).getByRole('option', { name: 'Front Office (3)' })).toBeInTheDocument();
    expect(within(pilih).getByRole('option', { name: 'Helpdesk OSS (2)' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Aktif: Informasi umum' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Aktif: Lainnya' })).not.toBeChecked();
    expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  });

  it('mengganti cakupan lewat daftar kiri menampilkan topik layanan itu; cakupan kosong menampilkan petunjuk', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const nav = screen.getByRole('navigation', { name: 'Pilih cakupan topik' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Helpdesk OSS 2' }));
    expect(screen.getByText('Pendampingan NIB')).toBeInTheDocument();
    expect(screen.queryByText('Informasi umum')).not.toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Helpdesk OSS 2' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(within(nav).getByRole('button', { name: 'BPJS Kesehatan 0' }));
    expect(screen.getByText(/Belum ada topik untuk BPJS Kesehatan/)).toBeInTheDocument();
    // Pilihan sempit (select) menyetel cakupan yang sama.
    fireEvent.change(screen.getByLabelText('Cakupan topik'), { target: { value: 'l-oss' } });
    expect(screen.getByText('Pendampingan NIB')).toBeInTheDocument();
  });

  it('tabel punya keterangan dan header kolom; tidak ada tombol hapus maupun dialog', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    expect(screen.getByRole('table', { name: 'Topik penanganan Front Office' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Topik', 'Urutan', 'Status']);
    expect(screen.queryByRole('button', { name: /hapus/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gagal memuat: pesan role=alert dan baris tambah tidak ada', async () => {
    buildMock({ topikError: true });
    render(<KelolaTopikPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat topik penanganan/);
    expect(screen.queryByRole('textbox', { name: 'Topik baru' })).not.toBeInTheDocument();
  });
});

describe('Kelola Topik: tambah lewat baris terakhir', () => {
  const siap = async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    return m;
  };

  it('validasi nama: terlalu pendek, kosong, dan duplikat tanpa beda huruf; insert tidak dipanggil', async () => {
    const m = await siap();
    const nama = kolomTambah();
    expect(nama).toHaveAttribute('maxlength', '100');

    fireEvent.change(nama, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah topik Front Office' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nama topik harus 2-100 karakter.');
    expect(nama).toHaveAttribute('aria-invalid', 'true');
    expect(nama.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);

    fireEvent.change(nama, { target: { value: '  informasi UMUM ' } });
    fireEvent.keyDown(nama, { key: 'Enter' });
    expect(await screen.findByText(/Sudah ada topik dengan nama itu/)).toBeInTheDocument();

    fireEvent.change(nama, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah topik Front Office' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nama topik harus 2-100 karakter.');
    expect(m.inserts).toHaveLength(0);
  });

  it('berhasil: insert langsung (layanan_id null, urutan = terbesar non-99 + 1), nama dipangkas, toast, isian dikosongkan, daftar dimuat ulang', async () => {
    const m = await siap();
    const muatAwal = m.jumlahMuat();
    const nama = kolomTambah();
    fireEvent.change(nama, { target: { value: '  Legalitas usaha  ' } });
    fireEvent.keyDown(nama, { key: 'Enter' });
    await waitFor(() => expect(m.inserts).toEqual([{ layanan_id: null, nama: 'Legalitas usaha', urut: 3, aktif: true }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Legalitas usaha" ditambahkan', 'success'));
    await waitFor(() => expect(kolomTambah()).toHaveValue(''));
    expect(m.jumlahMuat()).toBeGreaterThan(muatAwal);
  });

  it('pada cakupan layanan: layanan_id terisi, urutan mengikuti topik layanan itu, nama sama dengan cakupan lain boleh', async () => {
    const m = await siap();
    const nav = screen.getByRole('navigation', { name: 'Pilih cakupan topik' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Helpdesk OSS 2' }));
    fireEvent.change(kolomTambah(), { target: { value: 'Informasi umum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah topik Helpdesk OSS' }));
    await waitFor(() => expect(m.inserts).toEqual([{ layanan_id: 'l-oss', nama: 'Informasi umum', urut: 6, aktif: true }]));
  });

  it.each([
    ['23505', /Sudah ada topik dengan nama itu pada cakupan ini \(huruf besar\/kecil dianggap sama\)/],
    ['23514', /Nama topik harus 2-100 karakter/],
    ['42501', /tidak berwenang/],
    ['XX000', /Gagal menyimpan topik/],
  ])('galat DB %s dijelaskan di bawah isian (role=alert); isian tidak dikosongkan', async (code, pola) => {
    const m = buildMock({ insertHasil: { data: null, error: { code, message: 'x' } } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.change(kolomTambah(), { target: { value: 'Topik baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah topik Front Office' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pola);
    expect(kolomTambah()).toHaveValue('Topik baru');
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('ditambahkan'), 'success');
    expect(m.inserts).toHaveLength(1);
  });
});

describe('Kelola Topik: ubah nama langsung di sel', () => {
  it('klik nama membuka input terisi nilai lama dan berfokus; Enter menyimpan lewat id; nama sendiri tidak dianggap duplikat', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Ubah nama topik Pengaduan' }));
    const input = screen.getByRole('textbox', { name: 'Nama topik Pengaduan' });
    expect(input).toHaveValue('Pengaduan');
    expect(input).toHaveFocus();
    // Huruf besar/kecil saja yang berubah: tetap bukan bentrok dengan dirinya sendiri.
    fireEvent.change(input, { target: { value: '  pengaduan  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { nama: 'pengaduan' }, id: 't-fo-2' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "pengaduan" diperbarui', 'success'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nama topik Pengaduan' })).not.toBeInTheDocument());
  });

  it('blur menyimpan; tanpa perubahan tidak mengirim apa pun', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    ubahNamaInline('Pengaduan', 'Pengaduan layanan', 'blur');
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { nama: 'Pengaduan layanan' }, id: 't-fo-2' }]));
    cleanup();
    m.updates.length = 0;
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    ubahNamaInline('Pengaduan', 'Pengaduan', 'blur');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nama topik Pengaduan' })).not.toBeInTheDocument());
    expect(m.updates).toHaveLength(0);
  });

  it('Esc membatalkan tanpa menyimpan dan mengembalikan fokus ke tombol nama', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Ubah nama topik Pengaduan' }));
    const i2 = screen.getByRole('textbox', { name: 'Nama topik Pengaduan' });
    fireEvent.change(i2, { target: { value: 'Batal saja' } });
    fireEvent.keyDown(i2, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Nama topik Pengaduan' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ubah nama topik Pengaduan' })).toHaveFocus();
    expect(screen.getByText('Pengaduan')).toBeInTheDocument();
    expect(m.updates).toHaveLength(0);
  });

  it('mengganti nama menjadi nama topik lain di cakupan yang sama ditolak di bawah input (aria-describedby), tanpa update', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const input = ubahNamaInline('Pengaduan', 'informasi umum');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Sudah ada topik dengan nama itu/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(m.updates).toHaveLength(0);
    // Input tetap terbuka agar dapat diperbaiki.
    expect(screen.getByRole('textbox', { name: 'Nama topik Pengaduan' })).toBeInTheDocument();
  });

  it('nama terlalu pendek ditolak di klien', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    ubahNamaInline('Pengaduan', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Nama topik harus 2-100 karakter.');
    expect(m.updates).toHaveLength(0);
  });

  it('UPDATE 0 baris (ditolak RLS/baris hilang) = galat di bawah input dan daftar dimuat ulang, bukan sukses palsu', async () => {
    const m = buildMock({ updateHasil: { data: [], error: null } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const muatAwal = m.jumlahMuat();
    ubahNamaInline('Pengaduan', 'Pengaduan layanan');
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak berwenang mengubah data ini/);
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('diperbarui'), 'success');
    await waitFor(() => expect(m.jumlahMuat()).toBeGreaterThan(muatAwal));
  });

  it('input ber-aria-busy selama menyimpan dan hasil diumumkan lewat aria-live', async () => {
    let selesai: (v: Hasil) => void = () => {};
    const tertunda = new Promise<Hasil>((r) => { selesai = r; });
    buildMock({ updateHasil: tertunda });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const input = ubahNamaInline('Pengaduan', 'Pengaduan layanan');
    await waitFor(() => expect(input).toHaveAttribute('aria-busy', 'true'));
    selesai({ data: [{ id: 't-fo-2' }], error: null });
    await waitFor(() => expect(screen.getByText('Nama topik Pengaduan disimpan.')).toBeInTheDocument());
  });
});

describe('Kelola Topik: urutan naik/turun', () => {
  it('Turunkan menukar urut dua topik bertetangga (kedua baris disimpan), lalu daftar dimuat ulang', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const muatAwal = m.jumlahMuat();
    fireEvent.click(screen.getByRole('button', { name: 'Turunkan Informasi umum' }));
    await waitFor(() => expect(m.updates).toHaveLength(2));
    expect(m.updates).toEqual(expect.arrayContaining([
      { nilai: { urut: 2 }, id: 't-fo-1' },
      { nilai: { urut: 1 }, id: 't-fo-2' },
    ]));
    await waitFor(() => expect(m.jumlahMuat()).toBeGreaterThan(muatAwal));
  });

  it('Naikkan topik kedua menukar dengan yang pertama', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Naikkan Pengaduan' }));
    await waitFor(() => expect(m.updates).toHaveLength(2));
    expect(m.updates).toEqual(expect.arrayContaining([
      { nilai: { urut: 2 }, id: 't-fo-1' },
      { nilai: { urut: 1 }, id: 't-fo-2' },
    ]));
  });

  it('batas: yang teratas tak bisa naik; "Lainnya" (99) terkunci dan topik biasa tak bisa turun melewatinya', async () => {
    buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    expect(screen.getByRole('button', { name: 'Naikkan Informasi umum' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turunkan Informasi umum' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Turunkan Pengaduan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Naikkan Lainnya' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turunkan Lainnya' })).toBeDisabled();
  });

  it('galat menyimpan urutan: toast gagal, tidak ada toast sukses', async () => {
    buildMock({ updateHasil: { data: null, error: { code: 'XX000', message: 'boom' } } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('button', { name: 'Turunkan Informasi umum' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah urutan topik'), 'error'));
  });
});

describe('Kelola Topik: saklar status', () => {
  it('mematikan saklar topik aktif: update aktif=false (tanpa menghapus); toast; muat ulang', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const muatAwal = m.jumlahMuat();
    fireEvent.click(screen.getByRole('switch', { name: 'Aktif: Informasi umum' }));
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { aktif: false }, id: 't-fo-1' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Informasi umum" dinonaktifkan', 'success'));
    await waitFor(() => expect(m.jumlahMuat()).toBeGreaterThan(muatAwal));
  });

  it('menyalakan saklar topik nonaktif: update aktif=true', async () => {
    const m = buildMock();
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('switch', { name: 'Aktif: Lainnya' }));
    await waitFor(() => expect(m.updates).toEqual([{ nilai: { aktif: true }, id: 't-fo-99' }]));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Topik "Lainnya" diaktifkan', 'success'));
  });

  it('saklar dikunci selama request dan status diumumkan aria-live; klik ganda tidak mengirim dua kali', async () => {
    let selesai: (v: Hasil) => void = () => {};
    const tertunda = new Promise<Hasil>((r) => { selesai = r; });
    const m = buildMock({ updateHasil: tertunda });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    const saklar = screen.getByRole('switch', { name: 'Aktif: Informasi umum' });
    fireEvent.click(saklar);
    fireEvent.click(saklar);
    await waitFor(() => expect(saklar).toBeDisabled());
    expect(saklar).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Menonaktifkan topik Informasi umum…')).toHaveAttribute('aria-live', 'polite');
    expect(m.updates).toHaveLength(1);
    selesai({ data: [{ id: 't-fo-1' }], error: null });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('dinonaktifkan'), 'success'));
    await waitFor(() => expect(saklar).not.toBeDisabled());
  });

  it('galat: toast gagal (tidak ada toast sukses)', async () => {
    buildMock({ updateHasil: { data: null, error: { code: 'XX000', message: 'boom' } } });
    render(<KelolaTopikPage />);
    await screen.findByText('Informasi umum');
    fireEvent.click(screen.getByRole('switch', { name: 'Aktif: Informasi umum' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah status topik'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('dinonaktifkan'), 'success');
  });
});
